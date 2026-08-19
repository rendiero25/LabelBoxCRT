import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database"

/**
 * Riwayat satu Master Item, dirakit dari empat tabel yang menyimpan jejak
 * pengiriman: batch label box, box-nya sendiri, hasil scan produk, dan job
 * cetaknya beserta tiap percobaan.
 *
 * Satu baris riwayat adalah satu label box, bukan satu batch. Label box yang
 * jadi satuan karena itulah benda yang dicetak, discan, dan diverifikasi:
 * pertanyaan admin hampir selalu tentang satu box tertentu ("box B103 kapan
 * dicetak, siapa yang scan, kenapa gagal"), bukan tentang batch sebagai angka.
 *
 * Diambil dalam tiga kueri, bukan satu kueri bersarang empat tingkat. Sarang
 * sedalam itu menyeret seluruh scan dan percobaan cetak ke dalam satu respons
 * PostgREST, dan kegagalan izin di tingkat mana pun mengosongkan seluruh
 * hasilnya tanpa pesan yang jelas.
 */

export type ScanResult = Database["public"]["Enums"]["scan_result"]
export type LabelBoxStatus = Database["public"]["Enums"]["label_box_status"]
export type PackingSessionStatus =
  Database["public"]["Enums"]["packing_session_status"]
export type PrintJobStatus = Database["public"]["Enums"]["print_job_status"]
export type PrintAttemptResult =
  Database["public"]["Enums"]["print_attempt_result"]

export type HistoryScan = {
  errorCode: string | null
  id: string
  labelUid: string | null
  result: ScanResult
  scannedAt: string
  scannedPartNo: string
  scannedSize: string
}

export type HistoryPrintAttempt = {
  attemptNo: number
  createdAt: string
  errorCode: string | null
  errorMessage: string | null
  id: string
  printerName: string
  result: PrintAttemptResult
}

export type HistoryPrintJob = {
  attempts: HistoryPrintAttempt[]
  attemptCount: number
  confirmedAt: string | null
  createdAt: string
  id: string
  isReprint: boolean
  labelReference: string
  sentAt: string | null
  sequenceNo: number
  status: PrintJobStatus
  templateVersion: string
}

export type HistorySession = {
  cancelReason: string | null
  cancelledAt: string | null
  finalizedAt: string | null
  id: string
  readyAt: string | null
  startedAt: string
  status: PackingSessionStatus
}

export type MasterItemHistoryRow = {
  batchClosedAt: string | null
  batchCreatedAt: string
  batchId: string
  boxNo: number
  boxNumber: string
  createdAt: string
  deliveryDate: string
  deliveryNumber: string
  labelBoxId: string
  labelCount: number
  labelStatus: LabelBoxStatus
  lotNo: string
  packingQty: number
  printJobs: HistoryPrintJob[]
  /** Angka yang dicetak di baris Qty/Delivery label; isian field "Qty Delivery". */
  qtyDeliveryDisplay: number
  /** Keping yang dipak; isian field "Packing Qty", pembagi jumlah set label. */
  qtyDelivery: number
  rowNo: number
  scans: HistoryScan[]
  session: HistorySession | null
  setNo: number
}

export type MasterItemHistory = {
  error: string | null
  rows: MasterItemHistoryRow[]
}

type Client = SupabaseClient<Database>

export async function loadMasterItemHistory(
  supabase: Client,
  masterItemId: string,
): Promise<MasterItemHistory> {
  const batchesResult = await supabase
    .from("label_box_batches")
    // Rangkaian kolom harus satu string utuh, bukan sambungan `+`: tipe hasil
    // kueri diturunkan dari isi literalnya, dan sambungan membuatnya melebar
    // jadi `string` sehingga seluruh baris berubah jadi GenericStringError.
    .select(
      "id, created_at, closed_at, delivery_number_snapshot, delivery_date_snapshot, lot_no, qty_delivery, qty_delivery_display, packing_qty, label_count, master_item_row_no, label_boxes(id, box_number, set_no, box_no, status, created_at, packing_session_id, packing_sessions(id, status, started_at, ready_at, finalized_at, cancelled_at, cancel_reason))",
    )
    .eq("master_item_id", masterItemId)
    .order("created_at", { ascending: false })

  if (batchesResult.error) {
    return { error: "Riwayat tidak dapat dimuat.", rows: [] }
  }

  const batches = batchesResult.data ?? []
  const sessionIds = batches
    .flatMap((batch) => batch.label_boxes)
    .map((labelBox) => labelBox.packing_session_id)
    .filter((sessionId): sessionId is string => sessionId !== null)

  // Box yang belum pernah discan tidak punya sesi, jadi daftarnya bisa kosong.
  // `in` dengan daftar kosong tetap sah di PostgREST, tetapi memanggilnya dua
  // kali untuk hasil yang pasti kosong hanya menambah bolak-balik jaringan.
  const [scansResult, jobsResult] = sessionIds.length
    ? await Promise.all([
        supabase
          .from("packing_session_scans")
          .select(
            "id, packing_session_id, scanned_at, scanned_part_no, scanned_size, result, error_code, label_uid",
          )
          .in("packing_session_id", sessionIds)
          .order("scanned_at"),
        supabase
          .from("print_jobs")
          .select(
            "id, packing_session_id, status, created_at, sent_at, confirmed_at, attempt_count, label_reference, sequence_no, template_version, parent_print_job_id, print_attempts(id, attempt_no, printer_name, result, error_code, error_message_safe, created_at)",
          )
          .in("packing_session_id", sessionIds)
          .order("created_at"),
      ])
    : [null, null]

  if (scansResult?.error || jobsResult?.error) {
    return { error: "Riwayat scan dan cetak tidak dapat dimuat.", rows: [] }
  }

  const scansBySession = new Map<string, HistoryScan[]>()
  for (const scan of scansResult?.data ?? []) {
    const bucket = scansBySession.get(scan.packing_session_id) ?? []
    bucket.push({
      errorCode: scan.error_code,
      id: scan.id,
      labelUid: scan.label_uid,
      result: scan.result,
      scannedAt: scan.scanned_at,
      scannedPartNo: scan.scanned_part_no,
      scannedSize: scan.scanned_size,
    })
    scansBySession.set(scan.packing_session_id, bucket)
  }

  const jobsBySession = new Map<string, HistoryPrintJob[]>()
  for (const job of jobsResult?.data ?? []) {
    const bucket = jobsBySession.get(job.packing_session_id) ?? []
    bucket.push({
      attemptCount: job.attempt_count,
      attempts: job.print_attempts
        .map((attempt) => ({
          attemptNo: attempt.attempt_no,
          createdAt: attempt.created_at,
          errorCode: attempt.error_code,
          errorMessage: attempt.error_message_safe,
          id: attempt.id,
          printerName: attempt.printer_name,
          result: attempt.result,
        }))
        .sort((first, second) => first.attemptNo - second.attemptNo),
      confirmedAt: job.confirmed_at,
      createdAt: job.created_at,
      id: job.id,
      // Job cetak ulang menunjuk job induknya; tanpa penanda ini dua baris
      // cetak untuk box yang sama terbaca seperti label tercetak dua kali.
      isReprint: job.parent_print_job_id !== null,
      labelReference: job.label_reference,
      sentAt: job.sent_at,
      sequenceNo: job.sequence_no,
      status: job.status,
      templateVersion: job.template_version,
    })
    jobsBySession.set(job.packing_session_id, bucket)
  }

  const rows: MasterItemHistoryRow[] = []
  for (const batch of batches) {
    for (const labelBox of batch.label_boxes) {
      const sessionId = labelBox.packing_session_id
      const session = labelBox.packing_sessions

      rows.push({
        batchClosedAt: batch.closed_at,
        batchCreatedAt: batch.created_at,
        batchId: batch.id,
        boxNo: labelBox.box_no,
        boxNumber: labelBox.box_number,
        createdAt: labelBox.created_at,
        deliveryDate: batch.delivery_date_snapshot,
        deliveryNumber: batch.delivery_number_snapshot,
        labelBoxId: labelBox.id,
        labelCount: batch.label_count,
        labelStatus: labelBox.status,
        lotNo: batch.lot_no,
        packingQty: batch.packing_qty,
        printJobs: sessionId ? (jobsBySession.get(sessionId) ?? []) : [],
        qtyDelivery: batch.qty_delivery,
        qtyDeliveryDisplay: batch.qty_delivery_display ?? batch.qty_delivery,
        rowNo: batch.master_item_row_no,
        scans: sessionId ? (scansBySession.get(sessionId) ?? []) : [],
        session: session
          ? {
              cancelReason: session.cancel_reason,
              cancelledAt: session.cancelled_at,
              finalizedAt: session.finalized_at,
              id: session.id,
              readyAt: session.ready_at,
              startedAt: session.started_at,
              status: session.status,
            }
          : null,
        setNo: labelBox.set_no,
      })
    }
  }

  // Terbaru di atas, lalu urut nomor box supaya satu batch terbaca runtut.
  rows.sort(
    (first, second) =>
      second.batchCreatedAt.localeCompare(first.batchCreatedAt) ||
      first.setNo - second.setNo ||
      first.boxNo - second.boxNo,
  )

  return { error: null, rows }
}
