import Link from "next/link"
import { ArrowLeftIcon } from "lucide-react"
import { notFound } from "next/navigation"

import { LabelBoxBatchPrintCard } from "@/features/label-boxes/components/label-box-batch-print-card"
import { Button } from "@/components/ui/button"
import { requireOperator } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function LabelBoxPrintPage({
  params,
}: {
  params: Promise<{ batchId: string }>
}) {
  await requireOperator()
  const { batchId } = await params
  const supabase = await createClient()

  const { data: batch, error } = await supabase
    .from("label_box_batches")
    .select(
      "id, lot_no, label_count, closed_at, supplier_code_snapshot, item_code_snapshot, delivery_number_snapshot",
    )
    .eq("id", batchId)
    .maybeSingle()

  if (error || !batch || batch.closed_at === null) {
    notFound()
  }

  return (
    <section className="mx-auto grid max-w-2xl gap-6">
      <div>
        <Button asChild className="mb-2 px-0" variant="link">
          <Link href="/scan">
            <ArrowLeftIcon data-icon="inline-start" />
            Daftar label box
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">
          {batch.delivery_number_snapshot}
        </h1>
        <p className="text-muted-foreground text-sm">
          {batch.supplier_code_snapshot} · {batch.item_code_snapshot} · Lot{" "}
          {batch.lot_no} · {batch.label_count} label
        </p>
      </div>
      <LabelBoxBatchPrintCard batchId={batch.id} />
    </section>
  )
}
