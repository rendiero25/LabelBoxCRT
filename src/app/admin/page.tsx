import { SettingsIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

export default function AdminPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-muted-foreground text-sm font-medium">Phase 1</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Dashboard admin
        </h1>
      </div>
      <Alert>
        <SettingsIcon />
        <AlertTitle>Admin shell aktif</AlertTitle>
        <AlertDescription>
          Master data, workstation, print job, reprint, dan audit akan masuk
          pada fase berikutnya.
        </AlertDescription>
      </Alert>
    </div>
  )
}
