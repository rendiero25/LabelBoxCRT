import { Link2Icon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { requireAdmin } from "@/features/auth/server"
import {
  ProductMappingDirectory,
  type ProductMapping,
  type ProductMappingMasterItem,
  type ProductMappingProduct,
} from "@/features/product-mappings/components/product-mapping-directory"
import { createClient } from "@/lib/supabase/server"

type MappingRow = {
  id: string
  is_active: boolean
  master_items: ProductMappingMasterItem | null
  products: ProductMappingProduct | null
}

export default async function ProductMappingsPage() {
  await requireAdmin()
  const supabase = await createClient()
  const [mappingsResult, masterItemsResult, productsResult] = await Promise.all(
    [
      supabase
        .from("master_item_products")
        .select(
          "id, is_active, master_items(id, item_code, part_no, part_name, is_active), products(id, product_code, part_name, outer_diameter, inner_diameter, length, normalized_dimensions, is_active)",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("master_items")
        .select("id, item_code, part_no, part_name, is_active")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("part_no"),
      supabase
        .from("products")
        .select(
          "id, product_code, part_name, outer_diameter, inner_diameter, length, normalized_dimensions, is_active",
        )
        .eq("is_active", true)
        .order("product_code"),
    ],
  )

  const mappings = (
    (mappingsResult.data ?? []) as unknown as MappingRow[]
  ).flatMap((mapping): ProductMapping[] =>
    mapping.master_items && mapping.products
      ? [
          {
            id: mapping.id,
            is_active: mapping.is_active,
            masterItem: mapping.master_items,
            product: mapping.products,
          },
        ]
      : [],
  )
  const hasError =
    Boolean(mappingsResult.error) ||
    Boolean(masterItemsResult.error) ||
    Boolean(productsResult.error)

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm font-medium">Phase 4.5</p>
        <h1 className="text-2xl font-semibold">Product Mapping</h1>
        <p className="text-muted-foreground text-sm">
          Hubungkan banyak produk ke satu Master Item, lihat pemakaian balik,
          dan nonaktifkan mapping tanpa menghapus histori.
        </p>
      </div>

      {hasError ? (
        <Alert variant="destructive">
          <Link2Icon />
          <AlertTitle>Data Product Mapping tidak dapat dimuat</AlertTitle>
          <AlertDescription>
            Periksa koneksi Supabase atau izin admin.
          </AlertDescription>
        </Alert>
      ) : null}

      <ProductMappingDirectory
        mappings={mappings}
        masterItems={masterItemsResult.data ?? []}
        products={productsResult.data ?? []}
      />
    </div>
  )
}
