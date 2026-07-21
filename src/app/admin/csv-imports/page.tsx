import { FileSpreadsheetIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { requireAdmin } from "@/features/auth/server"
import { CsvImportWorkspace } from "@/features/csv-imports/components/csv-import-workspace"

export default async function CsvImportsPage() {
  await requireAdmin()

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm font-medium">Phase 4.7</p>
        <h1 className="text-2xl font-semibold">CSV Import</h1>
        <p className="text-muted-foreground text-sm">
          Preview seluruh baris dulu. Import disimpan satu transaksi atau tidak
          sama sekali.
        </p>
      </div>

      <Alert>
        <FileSpreadsheetIcon />
        <AlertTitle>Urutan data</AlertTitle>
        <AlertDescription>
          Import Supplier, Product, dan Master Item sebelum Delivery Number atau
          Product Mapping yang mereferensikannya.
        </AlertDescription>
      </Alert>

      <CsvImportWorkspace />
    </div>
  )
}
