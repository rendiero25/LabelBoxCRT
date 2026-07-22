"use client"

import { usePreferredPrinter } from "@/features/print/components/use-preferred-printer"
import { useQzConnection } from "@/features/print/use-qz-connection"
import { Badge } from "@/components/ui/badge"

export function AppStatus() {
  const { status } = useQzConnection()
  // Hydration-safe: null on the server snapshot, stored value after
  // hydration (useSyncExternalStore under the hood).
  const printer = usePreferredPrinter()

  return (
    <div aria-label="Status aplikasi" className="flex flex-wrap gap-2">
      <Badge variant="secondary">Aplikasi siap</Badge>
      <Badge variant={status === "connected" ? "secondary" : "outline"}>
        {status === "connected" ? "QZ terhubung" : "QZ belum terhubung"}
      </Badge>
      <Badge variant={printer ? "secondary" : "outline"}>
        {printer ? `Printer: ${printer}` : "Printer belum dipilih"}
      </Badge>
    </div>
  )
}
