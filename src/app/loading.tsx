import { Spinner } from "@/components/ui/spinner"

export default function Loading() {
  return (
    <div
      className="flex min-h-svh items-center justify-center gap-3"
      role="status"
    >
      <Spinner />
      <span className="text-muted-foreground text-sm">Memuat aplikasi…</span>
    </div>
  )
}
