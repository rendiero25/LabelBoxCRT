import { CircleAlertIcon } from "lucide-react"

import {
  LabelBoxBatchTable,
  type LabelBoxBatchRow,
} from "@/features/label-boxes/components/label-box-batch-table"
import { LabelBoxCloseToast } from "@/features/label-boxes/components/label-box-close-toast"
import { toLabelBoxMasterItemOptions } from "@/features/label-boxes/master-item-options"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { requireActiveUser } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ masterItemId?: string; verifikasi?: string }>
}) {
  await requireActiveUser()
  const { masterItemId, verifikasi } = await searchParams
  const closedSummary = parseClosedSummary(verifikasi)
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
        "id, supplier_id, master_item_id, packing_qty, qty_delivery, lot_no, operator_name, label_count, qr_generated_at, created_at, closed_at, supplier_code_snapshot, part_no_snapshot, delivery_number_snapshot, delivery_date_snapshot, packing_date, label_boxes(box_number, set_no, box_no, packing_session_id)",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("master_items")
      .select("id, item_code, part_no, default_label_qty, supplier_id")
      .eq("is_active", true)
      .is("deleted_at", null)
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

  // Seluruh Master Item aktif ditawarkan, sama seperti daftar di halaman admin.
  // Yang belum punya Box ikut masuk sebagai pilihan yang dinonaktifkan; membuang
  // barisnya membuat daftar di sini lebih pendek tanpa keterangan apa pun.
  const masterItems = toLabelBoxMasterItemOptions(
    masterItemsResult.data ?? [],
    boxesResult.data ?? [],
  )

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
      {closedSummary ? (
        <LabelBoxCloseToast
          labelCount={closedSummary.labelCount}
          verifiedCount={closedSummary.verifiedCount}
        />
      ) : null}
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
        prefillMasterItemId={
          masterItems.some((item) => item.id === masterItemId)
            ? (masterItemId ?? null)
            : null
        }
        suppliers={suppliers}
      />
    </div>
  )
}

/**
 * Ringkasan penutupan verifikasi, dibawa aksinya sebagai "terverifikasi-total".
 * Nilai yang tidak berbentuk itu diabaikan diam-diam: query datang dari alamat
 * yang bisa diketik siapa saja, dan tos berisi angka karangan lebih buruk
 * daripada tidak ada tos sama sekali.
 */
function parseClosedSummary(
  value: string | undefined,
): { labelCount: number; verifiedCount: number } | null {
  const match = /^(\d+)-(\d+)$/.exec(value ?? "")
  if (!match) return null

  return { labelCount: Number(match[2]), verifiedCount: Number(match[1]) }
}

type LabelBoxBatchQuery = {
  id: string
  supplier_id: string
  master_item_id: string
  packing_qty: number
  qty_delivery: number
  lot_no: string
  operator_name: string
  label_count: number
  qr_generated_at: string | null
  closed_at: string | null
  supplier_code_snapshot: string
  part_no_snapshot: string
  delivery_number_snapshot: string
  delivery_date_snapshot: string
  packing_date: string
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
    labelCount: batch.label_count,
    masterItemId: batch.master_item_id,
    lotNo: batch.lot_no,
    operatorName: batch.operator_name,
    packingDate: batch.packing_date,
    partNo: batch.part_no_snapshot,
    printed: batch.label_boxes.some(
      (labelBox) =>
        labelBox.packing_session_id !== null &&
        printedSessionIds.has(labelBox.packing_session_id),
    ),
    // Satu-satunya angka jumlah milik batch: ia yang dibagi Qty/Box Master Item
    // jadi jumlah set label, dan ia juga yang tercetak di baris Qty/Delivery.
    // Kolom packing_qty adalah Qty/Box milik Master Item, bukan isian formulir.
    qtyDelivery: batch.qty_delivery,
    supplierCode: batch.supplier_code_snapshot,
    supplierId: batch.supplier_id,
  }
}
