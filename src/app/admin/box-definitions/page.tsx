import { BoxesIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { requireAdmin } from "@/features/auth/server"
import {
  BoxDefinitionDirectory,
  type BoxDefinition,
  type BoxDefinitionMasterItem,
  type BoxDefinitionProduct,
} from "@/features/box-definitions/components/box-definition-directory"
import { createClient } from "@/lib/supabase/server"

type ProductRow = {
  id: string
  is_active: boolean
  product_code: string
  part_name: string
  normalized_dimensions: string | null
}

type RequirementRow = {
  id: string
  product_id: string
  expected_qty: number
  sort_order: number
  products: ProductRow | null
}

type LayerRow = {
  id: string
  layer_name: string
  layer_no: number
  sort_order: number
  box_layer_requirements: RequirementRow[]
}

type MasterItemRow = {
  id: string
  item_code: string
  part_no: string
  part_name: string
}

type BoxDefinitionRow = {
  id: string
  box_code: string
  box_name: string
  version: number
  is_active: boolean
  master_item_id: string
  master_items: MasterItemRow | null
  box_layers: LayerRow[]
}

type MappingRow = {
  master_item_id: string
  products: ProductRow | null
}

type PackingSessionRow = { box_definition_id: string }

export default async function BoxDefinitionsPage() {
  await requireAdmin()
  const supabase = await createClient()
  const [boxDefinitionsResult, masterItemsResult, mappingsResult, sessionsResult] =
    await Promise.all([
      supabase
        .from("box_definitions")
        .select(
          "id, box_code, box_name, version, is_active, master_item_id, master_items(id, item_code, part_no, part_name), box_layers(id, layer_name, layer_no, sort_order, box_layer_requirements(id, product_id, expected_qty, sort_order, products(id, is_active, product_code, part_name, normalized_dimensions)))",
        )
        .order("updated_at", { ascending: false }),
      supabase
        .from("master_items")
        .select("id, item_code, part_no, part_name")
        .eq("is_active", true)
        .order("part_no"),
      supabase
        .from("master_item_products")
        .select(
          "master_item_id, products(id, is_active, product_code, part_name, normalized_dimensions)",
        )
        .eq("is_active", true),
      supabase.from("packing_sessions").select("box_definition_id"),
    ])

  const boxDefinitions =
    (boxDefinitionsResult.data ?? []) as unknown as BoxDefinitionRow[]
  const masterItems = (masterItemsResult.data ?? []) as MasterItemRow[]
  const mappings = (mappingsResult.data ?? []) as unknown as MappingRow[]
  const usedBoxDefinitionIds = new Set(
    ((sessionsResult.data ?? []) as PackingSessionRow[]).map(
      (session) => session.box_definition_id,
    ),
  )
  const hasError =
    Boolean(boxDefinitionsResult.error) ||
    Boolean(masterItemsResult.error) ||
    Boolean(mappingsResult.error) ||
    Boolean(sessionsResult.error)
  const mappedProducts = mappings.reduce<Record<string, BoxDefinitionProduct[]>>(
    (result, mapping) => {
      if (!mapping.products?.is_active) return result

      const products = result[mapping.master_item_id] ?? []
      products.push({
        id: mapping.products.id,
        productCode: mapping.products.product_code,
        partName: mapping.products.part_name,
        normalizedDimensions: mapping.products.normalized_dimensions,
      })
      result[mapping.master_item_id] = products
      return result
    },
    {},
  )
  const directoryMasterItems: BoxDefinitionMasterItem[] = masterItems.map(
    (masterItem) => ({
      id: masterItem.id,
      itemCode: masterItem.item_code,
      partNo: masterItem.part_no,
      partName: masterItem.part_name,
    }),
  )
  const directoryDefinitions: BoxDefinition[] = boxDefinitions.map(
    (definition) => ({
      id: definition.id,
      masterItemId: definition.master_item_id,
      boxCode: definition.box_code,
      boxName: definition.box_name,
      version: definition.version,
      isActive: definition.is_active,
      masterItem: definition.master_items
        ? {
            id: definition.master_items.id,
            itemCode: definition.master_items.item_code,
            partNo: definition.master_items.part_no,
            partName: definition.master_items.part_name,
          }
        : null,
      layers: definition.box_layers.map((layer) => ({
        id: layer.id,
        layerNo: layer.layer_no,
        name: layer.layer_name,
        sortOrder: layer.sort_order,
        requirements: layer.box_layer_requirements.map((requirement) => ({
          id: requirement.id,
          productId: requirement.product_id,
          expectedQty: requirement.expected_qty,
          product: requirement.products
            ? {
                id: requirement.products.id,
                productCode: requirement.products.product_code,
                partName: requirement.products.part_name,
                normalizedDimensions: requirement.products.normalized_dimensions,
              }
            : null,
        })),
      })),
      isUsed: usedBoxDefinitionIds.has(definition.id),
    }),
  )

  return (
    <div className="flex max-w-6xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm font-medium">Phase 4.6</p>
        <h1 className="text-2xl font-semibold">Box Definition</h1>
        <p className="text-muted-foreground text-sm">
          Kelola versi box, layer, dan requirement produk untuk setiap Master Item.
        </p>
      </div>

      {hasError ? (
        <Alert variant="destructive">
          <BoxesIcon />
          <AlertTitle>Data Box Definition tidak dapat dimuat</AlertTitle>
          <AlertDescription>
            Periksa koneksi Supabase atau izin admin.
          </AlertDescription>
        </Alert>
      ) : null}

      <BoxDefinitionDirectory
        definitions={directoryDefinitions}
        mappedProducts={mappedProducts}
        masterItems={directoryMasterItems}
      />
    </div>
  )
}
