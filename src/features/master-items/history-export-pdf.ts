import PDFDocument from "pdfkit"

import type { MasterItemExportMeta } from "@/features/master-items/history-export"
import type { MasterItemHistoryRow } from "@/features/master-items/history"

/**
 * Riwayat satu label box sebagai PDF satu berkas — kartu box untuk dibaca,
 * dicetak, dan diarsipkan bersama surat jalannya.
 *
 * Isinya seluruh jejak box itu: identitas batch, tiap scan, dan tiap job cetak
 * beserta percobaannya. Muat karena lingkupnya satu box; ekspor seluruh Master
 * Item tidak akan pernah muat dan itu urusan Excel.
 */

const PAGE_MARGIN = 40
const ROW_HEIGHT = 13
const BODY_FONT_SIZE = 8.5

/**
 * Waktu dicetak dalam zona pabrik, bukan UTC. Admin yang mencocokkan laporan
 * dengan jam shift tidak punya cara tahu bahwa "02:00" di kertas berarti pukul
 * sembilan pagi.
 */
const TIME_ZONE = "Asia/Jakarta"

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "2-digit",
  timeZone: TIME_ZONE,
  year: "numeric",
})

const dateTimeFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  timeZone: TIME_ZONE,
  year: "numeric",
})

const SCAN_RESULT_LABEL: Record<string, string> = {
  accepted: "Diterima",
  duplicate: "Duplikat",
  invalid: "Tidak sah",
  over_qty: "Melebihi kuota",
}

const LABEL_STATUS_LABEL: Record<string, string> = {
  generated: "Belum diverifikasi",
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

/** Kode enum tanpa terjemahan dicetak apa adanya, bukan dikosongkan. */
function labelFor(dictionary: Record<string, string>, code: string): string {
  return dictionary[code] ?? code
}

function formatDateTime(iso: string | null): string {
  return iso === null ? "-" : dateTimeFormatter.format(new Date(iso))
}

function formatDate(iso: string | null): string {
  return iso === null ? "-" : dateFormatter.format(new Date(iso))
}

type TableColumn = {
  align?: "left" | "right"
  header: string
  width: number
}

export function buildLabelBoxHistoryPdf(
  meta: MasterItemExportMeta,
  row: MasterItemHistoryRow,
  now: Date,
): Promise<Buffer> {
  const document = new PDFDocument({ margin: PAGE_MARGIN, size: "A4" })

  document.info.Title = `Riwayat box ${row.boxNumber} · ${meta.itemCode}`
  document.info.Author = "Label Box CRT"
  document.info.Subject = `${meta.partNo} · ${meta.partName}`

  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(chunk))
    document.on("end", () => resolve(Buffer.concat(chunks)))
    document.on("error", reject)
  })

  const left = PAGE_MARGIN
  const right = document.page.width - PAGE_MARGIN
  const bottom = document.page.height - PAGE_MARGIN - ROW_HEIGHT

  /** Halaman baru dibuka sebelum barisnya ditulis, bukan sesudah tumpah. */
  function ensureSpace(y: number, needed = ROW_HEIGHT): number {
    if (y + needed <= bottom) return y
    document.addPage()
    return PAGE_MARGIN
  }

  function sectionTitle(title: string, y: number): number {
    const top = ensureSpace(y, ROW_HEIGHT * 3)
    document.font("Helvetica-Bold").fontSize(10).text(title, left, top)
    const next = top + 15
    document
      .moveTo(left, next - 4)
      .lineTo(right, next - 4)
      .lineWidth(0.5)
      .stroke()
    return next
  }

  function drawRow(
    columns: TableColumn[],
    values: string[],
    y: number,
    bold = false,
  ): number {
    document
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(BODY_FONT_SIZE)
    let x = left
    for (const [index, column] of columns.entries()) {
      document.text(values[index] ?? "", x, y, {
        align: column.align ?? "left",
        ellipsis: true,
        lineBreak: false,
        width: column.width - 4,
      })
      x += column.width
    }
    return y + ROW_HEIGHT
  }

  function table(
    columns: TableColumn[],
    rows: string[][],
    emptyText: string,
    y: number,
  ): number {
    const headers = columns.map((column) => column.header)

    if (rows.length === 0) {
      const top = ensureSpace(y)
      document
        .font("Helvetica")
        .fontSize(BODY_FONT_SIZE)
        .text(emptyText, left, top)
      return top + ROW_HEIGHT + 6
    }

    let next = drawRow(columns, headers, ensureSpace(y), true)
    for (const values of rows) {
      const top = ensureSpace(next)
      // Kepala kolom diulang di halaman berikutnya; tabel scan bisa panjang dan
      // kolom tanpa nama sama saja dengan deretan waktu tanpa keterangan.
      next =
        top === PAGE_MARGIN
          ? drawRow(columns, values, drawRow(columns, headers, top, true))
          : drawRow(columns, values, top)
    }
    return next + 6
  }

  document.font("Helvetica-Bold").fontSize(15)
  document.text(`Riwayat box ${row.boxNumber}`, left, PAGE_MARGIN)
  document.font("Helvetica").fontSize(9)
  document.text(`${meta.itemCode} · ${meta.partNo} · ${meta.partName}`)
  document.text(`Diunduh ${dateTimeFormatter.format(now)} WIB`)

  let y = sectionTitle("Batch & sesi", document.y + 12)

  const facts: [string, string][] = [
    ["Delivery Number", row.deliveryNumber],
    ["Tanggal Delivery", formatDate(row.deliveryDate)],
    ["Lot No", row.lotNo],
    ["Set / Box", `${row.setNo} / ${row.boxNo}`],
    ["Status label", labelFor(LABEL_STATUS_LABEL, row.labelStatus)],
    [
      "Status sesi",
      row.session
        ? labelFor(SESSION_STATUS_LABEL, row.session.status)
        : "Belum discan",
    ],
    ["Qty/Box", String(row.packingQty)],
    ["Packing Qty", String(row.qtyDelivery)],
    ["Qty Delivery", String(row.qtyDeliveryDisplay)],
    ["Item List", String(row.rowNo)],
    ["Label di batch", String(row.labelCount)],
    ["Batch dibuat", formatDateTime(row.batchCreatedAt)],
    ["Batch ditutup", formatDateTime(row.batchClosedAt)],
    ["Box dibuat", formatDateTime(row.createdAt)],
    ["Scan dimulai", formatDateTime(row.session?.startedAt ?? null)],
    ["Siap finalisasi", formatDateTime(row.session?.readyAt ?? null)],
    ["Difinalisasi", formatDateTime(row.session?.finalizedAt ?? null)],
  ]

  if (row.session?.cancelledAt) {
    facts.push([
      "Dibatalkan",
      `${formatDateTime(row.session.cancelledAt)}${
        row.session.cancelReason ? ` — ${row.session.cancelReason}` : ""
      }`,
    ])
  }

  // Dua pasang label-nilai per baris: satu kolom membuang separuh kertas, empat
  // memotong nilai yang panjang seperti nomor delivery.
  const factColumns: TableColumn[] = [
    { header: "", width: 95 },
    { header: "", width: 162 },
    { header: "", width: 95 },
    { header: "", width: 162 },
  ]

  for (let index = 0; index < facts.length; index += 2) {
    const [firstLabel, firstValue] = facts[index]
    const second = facts[index + 1]
    const top = ensureSpace(y)
    document.font("Helvetica-Bold").fontSize(BODY_FONT_SIZE)
    document.text(firstLabel, left, top, { lineBreak: false, width: 91 })
    if (second) {
      document.text(second[0], left + 257, top, { lineBreak: false, width: 91 })
    }
    y = drawRow(factColumns, ["", firstValue, "", second ? second[1] : ""], top)
  }

  y = sectionTitle(`Scan produk (${row.scans.length})`, y + 8)
  y = table(
    [
      { header: "Waktu", width: 92 },
      { header: "Part No", width: 96 },
      { header: "Ukuran", width: 78 },
      { header: "Hasil", width: 70 },
      { header: "Kode error", width: 90 },
      { header: "Label UID", width: 89 },
    ],
    row.scans.map((scan) => [
      formatDateTime(scan.scannedAt),
      scan.scannedPartNo,
      scan.scannedSize,
      labelFor(SCAN_RESULT_LABEL, scan.result),
      scan.errorCode ?? "-",
      scan.labelUid ?? "-",
    ]),
    "Box ini belum pernah discan.",
    y,
  )

  y = sectionTitle(`Job cetak (${row.printJobs.length})`, y + 8)

  if (row.printJobs.length === 0) {
    y = ensureSpace(y)
    document
      .font("Helvetica")
      .fontSize(BODY_FONT_SIZE)
      .text("Belum ada job cetak untuk box ini.", left, y)
  }

  for (const job of row.printJobs) {
    y = ensureSpace(y, ROW_HEIGHT * 3)
    y = drawRow(
      [
        { header: "", width: 150 },
        { header: "", width: 95 },
        { header: "", width: 100 },
        { header: "", width: 170 },
      ],
      [
        job.labelReference,
        labelFor(PRINT_STATUS_LABEL, job.status),
        job.isReprint ? "Cetak ulang" : "Cetak pertama",
        `Urutan ${job.sequenceNo} · Templat ${job.templateVersion}`,
      ],
      y,
      true,
    )
    y = drawRow(
      [{ header: "", width: 515 }],
      [
        `Dibuat ${formatDateTime(job.createdAt)} · Dikirim ${formatDateTime(
          job.sentAt,
        )} · Selesai ${formatDateTime(job.confirmedAt)}`,
      ],
      y,
    )
    y = table(
      [
        { align: "right", header: "#", width: 24 },
        { header: "Waktu", width: 92 },
        { header: "Printer", width: 130 },
        { header: "Hasil", width: 60 },
        { header: "Kode error", width: 95 },
        { header: "Pesan error", width: 114 },
      ],
      job.attempts.map((attempt) => [
        String(attempt.attemptNo),
        formatDateTime(attempt.createdAt),
        attempt.printerName,
        labelFor(ATTEMPT_RESULT_LABEL, attempt.result),
        attempt.errorCode ?? "-",
        attempt.errorMessage ?? "-",
      ]),
      "Belum ada percobaan tercatat.",
      y,
    )
  }

  document.end()
  return done
}
