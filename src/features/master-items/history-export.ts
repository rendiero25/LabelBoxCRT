import type { MasterItemHistoryRow } from "@/features/master-items/history"

/**
 * Riwayat Master Item sebagai data siap ekspor.
 *
 * Datanya bertingkat — satu label box membawa daftar scan, job cetak, dan
 * percobaan cetaknya sendiri — dan tingkatan itu tidak muat dalam satu tabel
 * datar. Memaksakannya berarti mengulang kolom batch di setiap percobaan cetak,
 * dan admin yang menghitung baris akan menghitung box yang sama berkali-kali.
 * Tiap tingkat karena itu jadi satu bagian sendiri, disambungkan Nomor Box dan
 * Delivery Number supaya masih bisa ditelusuri bolak-balik.
 *
 * Bagian-bagian ini dirakit sekali lalu dipakai ketiga format ekspor (Excel,
 * CSV, PDF). Merakit ulang tabelnya di tiap format berarti tiga daftar kolom
 * yang harus diubah bersama-sama, dan yang terlupa akan diam-diam mengekspor
 * kolom yang berbeda dari yang dilihat admin di layar.
 */

const SCAN_RESULT_LABEL: Record<string, string> = {
  accepted: "Diterima",
  duplicate: "Duplikat",
  invalid: "Tidak sah",
  over_qty: "Melebihi kuota",
}

const LABEL_STATUS_LABEL: Record<string, string> = {
  generated: "Dibuat",
  verified: "Terverifikasi",
}

const PRINT_STATUS_LABEL: Record<string, string> = {
  cancelled: "Dibatalkan",
  confirmed: "Dikonfirmasi",
  failed: "Gagal",
  pending: "Menunggu",
  printing: "Sedang dicetak",
  sent: "Terkirim",
}

const SESSION_STATUS_LABEL: Record<string, string> = {
  cancelled: "Dibatalkan",
  confirmed: "Dikonfirmasi",
  draft: "Draf",
  expired: "Kedaluwarsa",
  finalizing: "Sedang difinalisasi",
  print_failed: "Cetak gagal",
  print_pending: "Menunggu cetak",
  printing: "Sedang dicetak",
  ready_to_finalize: "Siap difinalisasi",
  scanning: "Sedang discan",
  sent_to_printer: "Terkirim ke printer",
}

const ATTEMPT_RESULT_LABEL: Record<string, string> = {
  failed: "Gagal",
  sent: "Terkirim",
}

/**
 * Kode enum yang belum punya terjemahan dicetak apa adanya, bukan dikosongkan:
 * status baru yang ditambahkan di migrasi akan tetap terbaca di berkasnya
 * meski namanya belum sempat dimasukkan ke daftar di atas.
 */
function labelFor(dictionary: Record<string, string>, code: string): string {
  return dictionary[code] ?? code
}

/**
 * Waktu disimpan sebagai objek tanggal, bukan teks: Excel butuh nilai tanggal
 * supaya kolomnya bisa diurutkan dan disaring, CSV butuh ISO supaya terbaca
 * mesin, dan PDF butuh format lokal. Kolom kosong dibiarkan kosong — string "-"
 * akan mengubah seluruh kolomnya jadi teks.
 */
function dateValue(iso: string | null): Date | null {
  return iso === null ? null : new Date(iso)
}

export type ColumnKind = "date" | "datetime" | "number" | "text"

export type HistoryColumn = {
  header: string
  key: string
  kind: ColumnKind
  width: number
}

export type HistoryCell = Date | number | string | null

export type HistorySection = {
  columns: HistoryColumn[]
  /** Dipakai sebagai pilihan format CSV dan potongan nama berkasnya. */
  key: string
  name: string
  rows: Record<string, HistoryCell>[]
}

export type MasterItemExportMeta = {
  itemCode: string
  partName: string
  partNo: string
}

export function buildHistorySections(
  rows: MasterItemHistoryRow[],
): HistorySection[] {
  return [
    {
      columns: [
        { header: "Nomor Box", key: "boxNumber", kind: "text", width: 12 },
        {
          header: "Delivery Number",
          key: "deliveryNumber",
          kind: "text",
          width: 20,
        },
        {
          header: "Tanggal Delivery",
          key: "deliveryDate",
          kind: "date",
          width: 16,
        },
        { header: "Lot No", key: "lotNo", kind: "text", width: 16 },
        { header: "Set", key: "setNo", kind: "number", width: 6 },
        { header: "Box", key: "boxNo", kind: "number", width: 6 },
        { header: "Status label", key: "labelStatus", kind: "text", width: 15 },
        { header: "Qty/Box", key: "packingQty", kind: "number", width: 10 },
        {
          header: "Packing Qty",
          key: "qtyDelivery",
          kind: "number",
          width: 12,
        },
        {
          header: "Qty Delivery",
          key: "qtyDeliveryDisplay",
          kind: "number",
          width: 12,
        },
        {
          header: "Jumlah label batch",
          key: "labelCount",
          kind: "number",
          width: 17,
        },
        {
          header: "Scan diterima",
          key: "acceptedScans",
          kind: "number",
          width: 14,
        },
        {
          header: "Scan ditolak",
          key: "rejectedScans",
          kind: "number",
          width: 13,
        },
        { header: "Job cetak", key: "printJobs", kind: "number", width: 10 },
        {
          header: "Status cetak terakhir",
          key: "lastPrintStatus",
          kind: "text",
          width: 20,
        },
        {
          header: "Status sesi",
          key: "sessionStatus",
          kind: "text",
          width: 14,
        },
        {
          header: "Batch dibuat",
          key: "batchCreatedAt",
          kind: "datetime",
          width: 18,
        },
        {
          header: "Batch ditutup",
          key: "batchClosedAt",
          kind: "datetime",
          width: 18,
        },
      ],
      key: "label-box",
      name: "Label box",
      rows: rows.map((row) => {
        // Job terakhir yang menjawab "label ini sudah keluar atau belum"; job
        // sebelumnya adalah cetak ulang yang sudah digantikan.
        const lastPrintJob = row.printJobs.at(-1)

        return {
          acceptedScans: row.scans.filter((scan) => scan.result === "accepted")
            .length,
          batchClosedAt: dateValue(row.batchClosedAt),
          batchCreatedAt: dateValue(row.batchCreatedAt),
          boxNo: row.boxNo,
          boxNumber: row.boxNumber,
          deliveryDate: dateValue(row.deliveryDate),
          deliveryNumber: row.deliveryNumber,
          labelCount: row.labelCount,
          labelStatus: labelFor(LABEL_STATUS_LABEL, row.labelStatus),
          lastPrintStatus: lastPrintJob
            ? labelFor(PRINT_STATUS_LABEL, lastPrintJob.status)
            : "Belum dicetak",
          lotNo: row.lotNo,
          packingQty: row.packingQty,
          qtyDeliveryDisplay: row.qtyDeliveryDisplay,
          printJobs: row.printJobs.length,
          qtyDelivery: row.qtyDelivery,
          rejectedScans: row.scans.filter((scan) => scan.result !== "accepted")
            .length,
          sessionStatus: row.session
            ? labelFor(SESSION_STATUS_LABEL, row.session.status)
            : "Belum discan",
          setNo: row.setNo,
        }
      }),
    },
    {
      // Isi panel detail di layar, kolom demi kolom: lembar ringkasan menjawab
      // "box mana", lembar ini menjawab "kapan tiap tahapnya terjadi". Tanpa
      // lembar ini jejak sesinya -- mulai scan, siap finalisasi, difinalisasi,
      // dibatalkan beserta alasannya -- hanya ada di layar dan hilang begitu
      // riwayatnya diekspor.
      columns: [
        { header: "Nomor Box", key: "boxNumber", kind: "text", width: 12 },
        {
          header: "Delivery Number",
          key: "deliveryNumber",
          kind: "text",
          width: 20,
        },
        { header: "Item List", key: "rowNo", kind: "number", width: 10 },
        { header: "Lot No", key: "lotNo", kind: "text", width: 16 },
        { header: "Set", key: "setNo", kind: "number", width: 6 },
        { header: "Box", key: "boxNo", kind: "number", width: 6 },
        { header: "Qty/Box", key: "packingQty", kind: "number", width: 10 },
        {
          header: "Packing Qty",
          key: "qtyDelivery",
          kind: "number",
          width: 12,
        },
        {
          header: "Qty/Delivery",
          key: "qtyDeliveryDisplay",
          kind: "number",
          width: 12,
        },
        {
          header: "Label di batch",
          key: "labelCount",
          kind: "number",
          width: 14,
        },
        { header: "Status label", key: "labelStatus", kind: "text", width: 18 },
        {
          header: "Status sesi",
          key: "sessionStatus",
          kind: "text",
          width: 18,
        },
        {
          header: "Batch dibuat",
          key: "batchCreatedAt",
          kind: "datetime",
          width: 18,
        },
        {
          header: "Batch ditutup",
          key: "batchClosedAt",
          kind: "datetime",
          width: 18,
        },
        {
          header: "Box dibuat",
          key: "boxCreatedAt",
          kind: "datetime",
          width: 18,
        },
        {
          header: "Scan dimulai",
          key: "sessionStartedAt",
          kind: "datetime",
          width: 18,
        },
        {
          header: "Siap finalisasi",
          key: "sessionReadyAt",
          kind: "datetime",
          width: 18,
        },
        {
          header: "Difinalisasi",
          key: "sessionFinalizedAt",
          kind: "datetime",
          width: 18,
        },
        {
          header: "Dibatalkan",
          key: "sessionCancelledAt",
          kind: "datetime",
          width: 18,
        },
        {
          header: "Alasan pembatalan",
          key: "sessionCancelReason",
          kind: "text",
          width: 40,
        },
        // Id ikut supaya baris di lembar ini bisa dicocokkan dengan datanya di
        // Supabase saat ada yang perlu ditelusuri sampai ke tabelnya.
        { header: "ID batch", key: "batchId", kind: "text", width: 38 },
        { header: "ID label box", key: "labelBoxId", kind: "text", width: 38 },
        { header: "ID sesi", key: "sessionId", kind: "text", width: 38 },
      ],
      key: "batch-sesi",
      name: "Batch & sesi",
      rows: rows.map((row) => ({
        batchClosedAt: dateValue(row.batchClosedAt),
        batchCreatedAt: dateValue(row.batchCreatedAt),
        batchId: row.batchId,
        boxCreatedAt: dateValue(row.createdAt),
        boxNo: row.boxNo,
        boxNumber: row.boxNumber,
        deliveryNumber: row.deliveryNumber,
        labelBoxId: row.labelBoxId,
        labelCount: row.labelCount,
        labelStatus: labelFor(LABEL_STATUS_LABEL, row.labelStatus),
        lotNo: row.lotNo,
        packingQty: row.packingQty,
        qtyDelivery: row.qtyDelivery,
        qtyDeliveryDisplay: row.qtyDeliveryDisplay,
        rowNo: row.rowNo,
        sessionCancelReason: row.session?.cancelReason ?? null,
        sessionCancelledAt: dateValue(row.session?.cancelledAt ?? null),
        sessionFinalizedAt: dateValue(row.session?.finalizedAt ?? null),
        sessionId: row.session?.id ?? null,
        sessionReadyAt: dateValue(row.session?.readyAt ?? null),
        sessionStartedAt: dateValue(row.session?.startedAt ?? null),
        sessionStatus: row.session
          ? labelFor(SESSION_STATUS_LABEL, row.session.status)
          : "Belum discan",
        setNo: row.setNo,
      })),
    },
    {
      columns: [
        { header: "Nomor Box", key: "boxNumber", kind: "text", width: 12 },
        {
          header: "Delivery Number",
          key: "deliveryNumber",
          kind: "text",
          width: 20,
        },
        {
          header: "Waktu scan",
          key: "scannedAt",
          kind: "datetime",
          width: 18,
        },
        {
          header: "Part No terscan",
          key: "scannedPartNo",
          kind: "text",
          width: 22,
        },
        {
          header: "Ukuran terscan",
          key: "scannedSize",
          kind: "text",
          width: 18,
        },
        { header: "Hasil", key: "result", kind: "text", width: 12 },
        { header: "Kode error", key: "errorCode", kind: "text", width: 26 },
        { header: "Label UID", key: "labelUid", kind: "text", width: 30 },
        { header: "ID scan", key: "scanId", kind: "text", width: 38 },
        { header: "ID sesi", key: "sessionId", kind: "text", width: 38 },
      ],
      key: "scan",
      name: "Scan",
      rows: rows.flatMap((row) =>
        row.scans.map((scan) => ({
          boxNumber: row.boxNumber,
          deliveryNumber: row.deliveryNumber,
          errorCode: scan.errorCode,
          labelUid: scan.labelUid,
          scanId: scan.id,
          sessionId: row.session?.id ?? null,
          result: labelFor(SCAN_RESULT_LABEL, scan.result),
          scannedAt: dateValue(scan.scannedAt),
          scannedPartNo: scan.scannedPartNo,
          scannedSize: scan.scannedSize,
        })),
      ),
    },
    {
      columns: [
        { header: "Nomor Box", key: "boxNumber", kind: "text", width: 12 },
        {
          header: "Delivery Number",
          key: "deliveryNumber",
          kind: "text",
          width: 20,
        },
        {
          header: "Label reference",
          key: "labelReference",
          kind: "text",
          width: 26,
        },
        { header: "Urutan", key: "sequenceNo", kind: "number", width: 8 },
        { header: "Status", key: "status", kind: "text", width: 15 },
        { header: "Cetak ulang", key: "isReprint", kind: "text", width: 12 },
        { header: "Percobaan", key: "attemptCount", kind: "number", width: 11 },
        {
          header: "Template",
          key: "templateVersion",
          kind: "text",
          width: 11,
        },
        { header: "Dibuat", key: "createdAt", kind: "datetime", width: 18 },
        { header: "Dikirim", key: "sentAt", kind: "datetime", width: 18 },
        {
          header: "Dikonfirmasi",
          key: "confirmedAt",
          kind: "datetime",
          width: 18,
        },
        { header: "ID job", key: "jobId", kind: "text", width: 38 },
      ],
      key: "cetak",
      name: "Cetak",
      rows: rows.flatMap((row) =>
        row.printJobs.map((job) => ({
          attemptCount: job.attemptCount,
          boxNumber: row.boxNumber,
          jobId: job.id,
          confirmedAt: dateValue(job.confirmedAt),
          createdAt: dateValue(job.createdAt),
          deliveryNumber: row.deliveryNumber,
          isReprint: job.isReprint ? "Ya" : "Tidak",
          labelReference: job.labelReference,
          sentAt: dateValue(job.sentAt),
          sequenceNo: job.sequenceNo,
          status: labelFor(PRINT_STATUS_LABEL, job.status),
          templateVersion: job.templateVersion,
        })),
      ),
    },
    {
      columns: [
        { header: "Nomor Box", key: "boxNumber", kind: "text", width: 12 },
        {
          header: "Label reference",
          key: "labelReference",
          kind: "text",
          width: 26,
        },
        { header: "Percobaan ke", key: "attemptNo", kind: "number", width: 13 },
        { header: "Waktu", key: "createdAt", kind: "datetime", width: 18 },
        { header: "Printer", key: "printerName", kind: "text", width: 28 },
        { header: "Hasil", key: "result", kind: "text", width: 12 },
        { header: "Kode error", key: "errorCode", kind: "text", width: 22 },
        { header: "Pesan error", key: "errorMessage", kind: "text", width: 40 },
        { header: "ID percobaan", key: "attemptId", kind: "text", width: 38 },
        { header: "ID job", key: "jobId", kind: "text", width: 38 },
      ],
      key: "percobaan-cetak",
      name: "Percobaan cetak",
      rows: rows.flatMap((row) =>
        row.printJobs.flatMap((job) =>
          job.attempts.map((attempt) => ({
            attemptId: attempt.id,
            attemptNo: attempt.attemptNo,
            boxNumber: row.boxNumber,
            jobId: job.id,
            createdAt: dateValue(attempt.createdAt),
            errorCode: attempt.errorCode,
            errorMessage: attempt.errorMessage,
            labelReference: job.labelReference,
            printerName: attempt.printerName,
            result: labelFor(ATTEMPT_RESULT_LABEL, attempt.result),
          })),
        ),
      ),
    },
  ]
}

/**
 * Daftar bagian untuk menu unduhan di halaman riwayat. Terpisah dari perakit
 * bagiannya karena menunya dirender di klien dan tidak boleh menyeret seluruh
 * riwayat — namanya harus tetap sama, dan itu dijaga oleh tesnya.
 */
export const HISTORY_SECTIONS = [
  { key: "label-box", name: "Label box" },
  { key: "batch-sesi", name: "Batch & sesi" },
  { key: "scan", name: "Scan" },
  { key: "cetak", name: "Cetak" },
  { key: "percobaan-cetak", name: "Percobaan cetak" },
] as const

export const EXPORT_FORMATS = ["xlsx", "csv", "pdf"] as const

export type ExportFormat = (typeof EXPORT_FORMATS)[number]

export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value)
}

/**
 * Nama berkas yang sudah menyebut isinya: Master Item mana, box mana, bagian
 * mana, dan diunduh kapan. Berkas bernama "riwayat.xlsx" di folder unduhan
 * tidak bisa dibedakan dari unduhan box sebelah.
 */
export function historyExportFilename(
  itemCode: string,
  now: Date,
  format: ExportFormat = "xlsx",
  suffixes: string[] = [],
): string {
  const stamp = now.toISOString().slice(0, 10)
  const safe = (text: string) => text.replace(/[^a-z0-9-]+/gi, "-")
  const parts = [safe(itemCode), ...suffixes.map(safe), stamp]
  return `riwayat-${parts.join("-")}.${format}`
}
