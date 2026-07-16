import { PackageSearchIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { MasterItemDirectory } from "@/features/master-items/components/master-item-directory"
import { requireAdmin } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function MasterItemsPage() {
  await requireAdmin()
  const supabase = await createClient()
  const { data: masterItems, error } = await supabase
    .from("master_items")
    .select(
      "id, item_code, part_no, part_name, unit, default_label_qty, item_sequence_code, is_active",
    )
    .order("item_code")

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

      <MasterItemDirectory masterItems={masterItems ?? []} />
    </div>
  )
}
