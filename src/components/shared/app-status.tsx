import { Badge } from "@/components/ui/badge"

const statuses = [
  { label: "Aplikasi siap", variant: "secondary" as const },
  { label: "QZ belum terhubung", variant: "outline" as const },
  { label: "Printer belum dipetakan", variant: "outline" as const },
]

export function AppStatus() {
  return (
    <div aria-label="Status aplikasi" className="flex flex-wrap gap-2">
      {statuses.map((status) => (
        <Badge key={status.label} variant={status.variant}>
          {status.label}
        </Badge>
      ))}
    </div>
  )
}
