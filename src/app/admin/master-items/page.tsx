import { PackageSearchIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { MasterItemDirectory } from "@/features/master-items/components/master-item-directory"
import { requireAdmin } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function MasterItemsPage() {
  await requireAdmin()
  const supabase = await createClient()
  const [masterItemsResult, productsResult, boxesResult, masterItemBoxesResult] =
    await Promise.all([
      supabase
        .from("master_items")
        .select(
          "id, item_code, part_no, part_name, unit, default_label_qty, item_sequence_code, is_active",
        )
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
        .select("id, box_code, box_name, box_layers(id, layer_no, layer_name)")
        .eq("is_active", true)
        .order("box_code"),
      supabase
        .from("master_item_boxes")
        .select(
          "id, master_item_id, box_id, version, is_active, box_layer_requirements(box_layer_id, product_id, expected_qty), packing_sessions(id)",
        ),
    ])
  const error =
    masterItemsResult.error ??
    productsResult.error ??
    boxesResult.error ??
    masterItemBoxesResult.error
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
    boxCode: box.box_code,
    boxName: box.box_name,
    layers: box.box_layers
      .map((layer) => ({
        id: layer.id,
        layerNo: layer.layer_no,
        name: layer.layer_name,
      }))
      .sort((first, second) => first.layerNo - second.layerNo),
  }))
  const masterItemBoxes = (masterItemBoxesResult.data ?? []).map(
    (assignment) => {
      const requirementsByLayer: Record<
        string,
        { productId: string; expectedQty: number }[]
      > = {}

      for (const requirement of assignment.box_layer_requirements) {
        const list = requirementsByLayer[requirement.box_layer_id] ?? []
        list.push({
          productId: requirement.product_id,
          expectedQty: requirement.expected_qty,
        })
        requirementsByLayer[requirement.box_layer_id] = list
      }

      return {
        id: assignment.id,
        masterItemId: assignment.master_item_id,
        boxId: assignment.box_id,
        version: assignment.version,
        isActive: assignment.is_active,
        isUsed: assignment.packing_sessions.length > 0,
        requirementsByLayer,
      }
    },
  )

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Master Item</h1>
        <p className="text-muted-foreground text-sm">
          Part No, unit, dan default Qty menjadi sumber data label. Kode
          sequence masih metadata hingga scope sequence dikunci.
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

      <MasterItemDirectory
        boxes={boxes}
        masterItemBoxes={masterItemBoxes}
        masterItems={masterItems}
        products={products}
      />
    </div>
  )
}
