import { BoxesIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { requireAdmin } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

type ProductRow = {
  id: string
  is_active: boolean
  product_code: string
  part_name: string
  normalized_dimensions: string
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
  is_active: boolean
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
  is_active: boolean
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
          "id, box_code, box_name, version, is_active, master_item_id, master_items(id, item_code, part_no, part_name, is_active), box_layers(id, is_active, layer_name, layer_no, sort_order, box_layer_requirements(id, product_id, expected_qty, sort_order, products(id, is_active, product_code, part_name, normalized_dimensions)))",
        )
        .order("updated_at", { ascending: false }),
      supabase
        .from("master_items")
        .select("id, item_code, part_no, part_name, is_active")
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

  return (
    <div className="flex max-w-6xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm font-medium">Phase 4.6</p>
        <h1 className="text-2xl font-semibold">Box Definition</h1>
        <p className="text-muted-foreground text-sm">
          Kelola versi box, layer, dan requirement produk untuk setiap Master
          Item.
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

      <section
        className="rounded-lg border p-4 text-sm"
        aria-label="Ringkasan Box Definition"
      >
        <p className="font-medium">{boxDefinitions.length} definisi box</p>
        <p className="text-muted-foreground mt-1">
          {masterItems.length} Master Item aktif dan {mappings.length} mapping
          produk aktif siap dipakai.
        </p>
        <ul className="mt-4 space-y-2">
          {boxDefinitions.map((boxDefinition) => (
            <li key={boxDefinition.id} className="text-muted-foreground">
              <span className="font-medium text-foreground">
                {boxDefinition.box_code} v{boxDefinition.version}
              </span>{" "}
              — {boxDefinition.master_items?.part_no ?? "Master Item tidak ditemukan"},{" "}
              {boxDefinition.box_layers.length} layer
              {usedBoxDefinitionIds.has(boxDefinition.id)
                ? " · sudah digunakan"
                : " · belum digunakan"}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
