import { PackageSearchIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { MasterItemDirectory } from "@/features/master-items/components/master-item-directory"
import { requireAdmin } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function MasterItemsPage() {
  await requireAdmin()
  const supabase = await createClient()
  const [masterItemsResult, productsResult, boxesResult] = await Promise.all([
    supabase
      .from("master_items")
      .select("id, item_code, part_no, part_name, unit, default_label_qty, is_active")
      .order("item_code"),
    supabase
      .from("products")
      .select(
        "id, product_code, part_name, outer_diameter, inner_diameter, length, normalized_dimensions",
      )
      .eq("is_active", true)
      .order("product_code"),
    supabase
      .from("boxes")
      .select(
        "id, master_item_id, box_no, box_code, box_name, box_layers(id, layer_no, layer_name, box_layer_requirements(product_id, expected_qty)), packing_sessions(id)",
      )
      .order("box_no"),
  ])
  const error = masterItemsResult.error ?? productsResult.error ?? boxesResult.error
  const masterItems = masterItemsResult.data ?? []
  const products = (productsResult.data ?? []).map((product) => ({
    id: product.id,
    productCode: product.product_code,
    partName: product.part_name,
    outerDiameter: product.outer_diameter,
    innerDiameter: product.inner_diameter,
    length: product.length,
    normalizedDimensions: product.normalized_dimensions,
  }))
  const boxes = (boxesResult.data ?? []).map((box) => ({
    id: box.id,
    masterItemId: box.master_item_id,
    boxNo: box.box_no,
    boxCode: box.box_code,
    boxName: box.box_name,
    isUsed: box.packing_sessions.length > 0,
    layers: box.box_layers
      .map((layer) => ({
        id: layer.id,
        layerNo: layer.layer_no,
        layerName: layer.layer_name,
        requirements: layer.box_layer_requirements.map((requirement) => ({
          productId: requirement.product_id,
          expectedQty: requirement.expected_qty,
        })),
      }))
      .sort((first, second) => first.layerNo - second.layerNo),
  }))

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Master Item</h1>
        <p className="text-muted-foreground text-sm">
          Part No, unit, dan Packing Qty menjadi sumber data label. Tiap Master
          Item memiliki maksimal 3 Box.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <PackageSearchIcon />
          <AlertTitle>Data Master Item tidak dapat dimuat</AlertTitle>
          <AlertDescription>
            Periksa koneksi Supabase atau izin admin.
          </AlertDescription>
        </Alert>
      ) : null}

      <MasterItemDirectory boxes={boxes} masterItems={masterItems} products={products} />
    </div>
  )
}
