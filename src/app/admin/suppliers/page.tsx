import { Building2Icon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { SupplierDirectory } from "@/features/suppliers/components/supplier-directory"
import { requireAdmin } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function SuppliersPage() {
  await requireAdmin()
  const supabase = await createClient()
  const { data: suppliers, error } = await supabase
    .from("suppliers")
    .select("id, supplier_code, supplier_name, is_active")
    .order("supplier_code")

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm font-medium">Phase 4.1</p>
        <h1 className="text-2xl font-semibold">Supplier</h1>
        <p className="text-muted-foreground text-sm">
          Kelola kode dan nama supplier. Data yang sudah direferensikan tetap
          dipertahankan melalui nonaktif, bukan dihapus.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <Building2Icon />
          <AlertTitle>Data supplier tidak dapat dimuat</AlertTitle>
          <AlertDescription>
            Periksa koneksi Supabase atau izin admin.
          </AlertDescription>
        </Alert>
      ) : null}

      <SupplierDirectory suppliers={suppliers ?? []} />
    </div>
  )
}
