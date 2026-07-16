import { BoxesIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ProductDirectory } from "@/features/products/components/product-directory"
import { requireAdmin } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function ProductsPage() {
  await requireAdmin()
  const supabase = await createClient()
  const { data: products, error } = await supabase
    .from("products")
    .select(
      "id, product_code, part_name, outer_diameter, inner_diameter, length, normalized_dimensions, is_active",
    )
    .order("product_code")

  return (
    <div className="flex max-w-6xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm font-medium">Phase 4.3</p>
        <h1 className="text-2xl font-semibold">Produk</h1>
        <p className="text-muted-foreground text-sm">
          Preview ukuran mengikuti format label; key database tetap memakai OD ×
          ID × Length untuk pencarian dan validasi.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <BoxesIcon />
          <AlertTitle>Data produk tidak dapat dimuat</AlertTitle>
          <AlertDescription>
            Periksa koneksi Supabase atau izin admin.
          </AlertDescription>
        </Alert>
      ) : null}

      <ProductDirectory products={products ?? []} />
    </div>
  )
}
