import { LayersIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { MpqSheetDirectory } from "@/features/mpq-sheet/components/mpq-sheet-directory"
import { requireAdmin } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function MpqSheetPage() {
  await requireAdmin()
  const supabase = await createClient()
  const { data: rows, error } = await supabase
    .from("mpq_sheet_rows")
    .select("id, row_no, product_size, mpq_qty, unit")
    .order("row_no")

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">MPQ Sheet</h1>
        <p className="text-muted-foreground text-sm">
          Jumlah sheet maksimum dalam satu box per ukuran, menyalin dokumen
          &quot;List MPQ CRT&quot; (update 27 September 2021). Daftar rujukan;
          revisinya masuk lewat migrasi, tidak disunting dari layar ini.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <LayersIcon />
          <AlertTitle>Data MPQ tidak dapat dimuat</AlertTitle>
          <AlertDescription>
            Periksa koneksi Supabase atau izin admin.
          </AlertDescription>
        </Alert>
      ) : null}

      <MpqSheetDirectory rows={rows ?? []} />
    </div>
  )
}
