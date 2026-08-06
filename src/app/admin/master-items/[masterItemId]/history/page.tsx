import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeftIcon, HistoryIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { MasterItemHistoryView } from "@/features/master-items/components/master-item-history"
import { loadMasterItemHistory } from "@/features/master-items/history"
import { requireAdmin } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function MasterItemHistoryPage({
  params,
}: {
  params: Promise<{ masterItemId: string }>
}) {
  await requireAdmin()
  const { masterItemId } = await params
  const supabase = await createClient()

  const masterItemResult = await supabase
    .from("master_items")
    .select("id, item_code, part_no, part_name, unit, default_label_qty")
    .eq("id", masterItemId)
    .maybeSingle()

  if (masterItemResult.error || !masterItemResult.data) notFound()
  const masterItem = masterItemResult.data
  const history = await loadMasterItemHistory(supabase, masterItemId)

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button asChild className="w-fit" size="sm" variant="ghost">
          <Link href="/admin/master-items">
            <ArrowLeftIcon data-icon="inline-start" />
            Master Item
          </Link>
        </Button>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">
            Riwayat {masterItem.item_code}
          </h1>
          <p className="text-muted-foreground text-sm">
            {masterItem.part_no} · {masterItem.part_name} · Packing Qty{" "}
            {masterItem.default_label_qty} {masterItem.unit}
          </p>
        </div>
      </div>

      {history.error ? (
        <Alert variant="destructive">
          <HistoryIcon />
          <AlertTitle>Riwayat tidak dapat dimuat</AlertTitle>
          <AlertDescription>{history.error}</AlertDescription>
        </Alert>
      ) : (
        <MasterItemHistoryView rows={history.rows} />
      )}
    </div>
  )
}
