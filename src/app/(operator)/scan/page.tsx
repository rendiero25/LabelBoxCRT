import { CircleAlertIcon } from "lucide-react"

import {
  LabelBoxBatchTable,
  type LabelBoxBatchRow,
} from "@/features/label-boxes/components/label-box-batch-table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { requireOperator } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function ScanPage() {
  await requireOperator()
  const supabase = await createClient()

  const [
    batchesResult,
    masterItemsResult,
    boxesResult,
    suppliersResult,
    printJobsResult,
  ] = await Promise.all([
    supabase
      .from("label_box_batches")
      .select(
        "id, packing_qty, qty_delivery, lot_no, label_count, qr_generated_at, created_at, closed_at, supplier_code_snapshot, item_code_snapshot, delivery_number_snapshot, delivery_date_snapshot, label_boxes(box_number, set_no, box_no, packing_session_id)",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("master_items")
      .select("id, item_code, part_no, default_label_qty, supplier_id")
      .eq("is_active", true)
      .order("item_code"),
    supabase.from("boxes").select("id, master_item_id"),
    supabase
      .from("suppliers")
      .select("id, supplier_code")
      .eq("is_active", true)
      .order("supplier_code"),
    supabase
      .from("print_jobs")
      .select("packing_session_id")
      .is("parent_print_job_id", null),
  ])

  const dataError =
    batchesResult.error ??
    masterItemsResult.error ??
    boxesResult.error ??
    suppliersResult.error ??
    printJobsResult.error

  const boxRows = boxesResult.data ?? []
  const masterItems = (masterItemsResult.data ?? [])
    .filter((item) => boxRows.some((box) => box.master_item_id === item.id))
    .map((item) => ({
      id: item.id,
      itemCode: item.item_code,
      packingQty: item.default_label_qty,
      partNo: item.part_no,
      supplierId: item.supplier_id,
    }))

  const suppliers = (suppliersResult.data ?? []).map((supplier) => ({
    id: supplier.id,
    supplierCode: supplier.supplier_code,
  }))

  const printedSessionIds = new Set(
    (printJobsResult.data ?? []).map((job) => job.packing_session_id),
  )

  const batches = (batchesResult.data ?? []).map((batch) =>
    toLabelBoxBatchRow(batch, printedSessionIds),
  )

  return (
    <div className="flex w-full flex-col gap-6">
      {dataError ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Data label box tidak dapat dimuat</AlertTitle>
          <AlertDescription>
            Periksa koneksi Supabase atau izin operator.
          </AlertDescription>
        </Alert>
      ) : null}
      <LabelBoxBatchTable
        batches={batches}
        masterItems={masterItems}
        suppliers={suppliers}
      />
    </div>
  )
}

type LabelBoxBatchQuery = {
  id: string
  packing_qty: number
  qty_delivery: number
  lot_no: string
  label_count: number
  qr_generated_at: string | null
  closed_at: string | null
  supplier_code_snapshot: string
  item_code_snapshot: string
  delivery_number_snapshot: string
  delivery_date_snapshot: string
  label_boxes: Array<{
    box_number: string
    set_no: number
    box_no: number
    packing_session_id: string | null
  }>
}

function toLabelBoxBatchRow(
  batch: LabelBoxBatchQuery,
  printedSessionIds: Set<string | null>,
): LabelBoxBatchRow {
  return {
    boxNumbers: [...batch.label_boxes]
      .sort((left, right) =>
        left.set_no === right.set_no
          ? left.box_no - right.box_no
          : left.set_no - right.set_no,
      )
      .map((labelBox) => labelBox.box_number),
    closed: batch.closed_at !== null,
    deliveryDate: batch.delivery_date_snapshot,
    deliveryNumber: batch.delivery_number_snapshot,
    id: batch.id,
    itemCode: batch.item_code_snapshot,
    labelCount: batch.label_count,
    lotNo: batch.lot_no,
    packingQty: batch.packing_qty,
    printed: batch.label_boxes.some(
      (labelBox) =>
        labelBox.packing_session_id !== null &&
        printedSessionIds.has(labelBox.packing_session_id),
    ),
    qtyDelivery: batch.qty_delivery,
    supplierCode: batch.supplier_code_snapshot,
  }
}
