import { PackageSearchIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { MasterItemDirectory } from "@/features/master-items/components/master-item-directory"
import { requireAdmin } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function MasterItemsPage() {
  await requireAdmin()
  const supabase = await createClient()
  const [masterItemsResult, productsResult, boxDefinitionsResult] =
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
        .from("box_definitions")
        .select(
          "id, master_item_id, box_code, box_name, version, is_active, box_layers(id, layer_no, layer_name, sort_order, box_layer_requirements(id, product_id, expected_qty, sort_order)), packing_sessions(id)",
        )
        .order("box_code"),
    ])
  const error =
    masterItemsResult.error ?? productsResult.error ?? boxDefinitionsResult.error
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
  const boxDefinitions = (boxDefinitionsResult.data ?? []).map((definition) => ({
    id: definition.id,
    masterItemId: definition.master_item_id,
    boxCode: definition.box_code,
    boxName: definition.box_name,
    version: definition.version,
    isActive: definition.is_active,
    isUsed: definition.packing_sessions.length > 0,
    layers: definition.box_layers
      .map((layer) => ({
        id: layer.id,
        layerNo: layer.layer_no,
        name: layer.layer_name,
        requirements: layer.box_layer_requirements
          .map((requirement) => ({
            id: requirement.id,
            productId: requirement.product_id,
            expectedQty: requirement.expected_qty,
            sortOrder: requirement.sort_order,
          }))
          .sort((first, second) => first.sortOrder - second.sortOrder)
          .map(({ sortOrder: _sortOrder, ...requirement }) => requirement),
      }))
      .sort((first, second) => first.layerNo - second.layerNo),
  }))

  return (
    <div className="flex max-w-6xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm font-medium">Phase 4.4</p>
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
        boxDefinitions={boxDefinitions}
        masterItems={masterItems}
        products={products}
      />
    </div>
  )
}
