import { CircleCheckIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

export default function ScanPage() {
  return (
    <div className="space-y-6">
      <Alert>
        <CircleCheckIcon />
        <AlertTitle>Operator shell aktif</AlertTitle>
        <AlertDescription>
          Listener scanner, packing session, dan koneksi QZ Tray akan
          ditambahkan pada fase domain terkait.
        </AlertDescription>
      </Alert>
      <Empty className="bg-background border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleCheckIcon />
          </EmptyMedia>
          <EmptyTitle>Belum ada packing session aktif</EmptyTitle>
          <EmptyDescription>
            Phase 1 menyiapkan layout operator dan status workstation tanpa
            mengunci aturan scan yang masih terbuka.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  )
}
