import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"

import type { MasterItemHistoryRow } from "@/features/master-items/history"
import {
  HISTORY_SECTIONS,
  buildHistorySections,
  historyExportFilename,
} from "@/features/master-items/history-export"
import { buildMasterItemHistoryCsv } from "@/features/master-items/history-export-csv"
import { buildLabelBoxHistoryPdf } from "@/features/master-items/history-export-pdf"
import { buildMasterItemHistoryWorkbook } from "@/features/master-items/history-export-xlsx"

const meta = {
  itemCode: "MI-0001",
  partName: "Tube Assy",
  partNo: "3210A-K1Z-NA01-DL",
}

function historyRow(
  overrides: Partial<MasterItemHistoryRow> = {},
): MasterItemHistoryRow {
  return {
    batchClosedAt: "2026-08-14T09:00:00.000Z",
    batchCreatedAt: "2026-08-12T02:00:00.000Z",
    batchId: "11111111-1111-4111-8111-111111111111",
    boxNo: 1,
    boxNumber: "B101",
    createdAt: "2026-08-12T02:00:00.000Z",
    deliveryDate: "2026-08-26",
    deliveryNumber: "DN-08-2026-12599",
    labelBoxId: "22222222-2222-4222-8222-222222222222",
    labelCount: 3,
    labelStatus: "verified",
    lotNo: "CRT082805",
    packingQty: 100,
    printJobs: [
      {
        attemptCount: 2,
        attempts: [
          {
            attemptNo: 1,
            createdAt: "2026-08-12T03:00:00.000Z",
            errorCode: "QZ_SEND_FAILED",
            errorMessage: "Gagal mengirim ke printer.",
            id: "att-1",
            printerName: "Canon G4010 series",
            result: "failed",
          },
          {
            attemptNo: 2,
            createdAt: "2026-08-12T03:05:00.000Z",
            errorCode: null,
            errorMessage: null,
            id: "att-2",
            printerName: "Canon G4010 series",
            result: "sent",
          },
        ],
        confirmedAt: "2026-08-12T03:06:00.000Z",
        createdAt: "2026-08-12T02:59:00.000Z",
        id: "job-1",
        isReprint: false,
        labelReference: "111-260826-B101",
        sentAt: "2026-08-12T03:05:00.000Z",
        sequenceNo: 1,
        status: "confirmed",
        templateVersion: "v9",
      },
    ],
    qtyDelivery: 100,
    rowNo: 1,
    scans: [
      {
        errorCode: null,
        id: "scan-1",
        labelUid: "UID-1",
        result: "accepted",
        scannedAt: "2026-08-12T02:30:00.000Z",
        scannedPartNo: "VO-B",
        scannedSize: "6x7x455",
      },
      {
        errorCode: "LABEL_ALREADY_SCANNED",
        id: "scan-2",
        labelUid: "UID-1",
        result: "duplicate",
        scannedAt: "2026-08-12T02:31:00.000Z",
        scannedPartNo: "VO-B",
        scannedSize: "6x7x455",
      },
    ],
    session: {
      cancelReason: null,
      cancelledAt: null,
      finalizedAt: "2026-08-12T02:45:00.000Z",
      id: "session-1",
      readyAt: "2026-08-12T02:40:00.000Z",
      startedAt: "2026-08-12T02:20:00.000Z",
      status: "confirmed",
    },
    setNo: 1,
    ...overrides,
  }
}

/** Workbook dibaca ulang, bukan diperiksa dari objek yang baru saja dirakit. */
async function readBack(workbook: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const buffer = await workbook.xlsx.writeBuffer()
  const reopened = new ExcelJS.Workbook()
  await reopened.xlsx.load(buffer as ArrayBuffer)
  return reopened
}

function headers(sheet: ExcelJS.Worksheet): string[] {
  const row = sheet.getRow(1)
  return (row.values as unknown[]).slice(1).map((value) => String(value))
}

function cell(
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  header: string,
): ExcelJS.CellValue {
  const column = headers(sheet).indexOf(header) + 1
  return sheet.getRow(rowNumber).getCell(column).value
}

describe("buildMasterItemHistoryWorkbook", () => {
  it("gives every level of the history its own sheet", async () => {
    const workbook = await readBack(
      buildMasterItemHistoryWorkbook(meta, [historyRow()]),
    )

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Master Item",
      "Label box",
      "Batch & sesi",
      "Scan",
      "Cetak",
      "Percobaan cetak",
    ])
  })

  it("names the master item on its own sheet", async () => {
    const workbook = await readBack(
      buildMasterItemHistoryWorkbook(meta, [historyRow()]),
    )
    const sheet = workbook.getWorksheet("Master Item")!

    expect(cell(sheet, 2, "Item Code")).toBe("MI-0001")
    expect(cell(sheet, 2, "Part No")).toBe("3210A-K1Z-NA01-DL")
    expect(cell(sheet, 2, "Part Name")).toBe("Tube Assy")
    expect(cell(sheet, 2, "Jumlah label box")).toBe(1)
  })

  // Panel detail di layar memperlihatkan jejak sesi lengkap; berkasnya harus
  // membawa jejak yang sama, bukan hanya ringkasannya.
  it("carries every batch and session moment the detail panel shows", async () => {
    const workbook = await readBack(
      buildMasterItemHistoryWorkbook(meta, [
        historyRow({
          session: {
            cancelReason: "Salah delivery",
            cancelledAt: "2026-08-12T04:00:00.000Z",
            finalizedAt: "2026-08-12T02:45:00.000Z",
            id: "session-1",
            readyAt: "2026-08-12T02:40:00.000Z",
            startedAt: "2026-08-12T02:20:00.000Z",
            status: "cancelled",
          },
        }),
      ]),
    )
    const sheet = workbook.getWorksheet("Batch & sesi")!

    expect(cell(sheet, 2, "Nomor Box")).toBe("B101")
    expect(cell(sheet, 2, "Item List")).toBe(1)
    expect(cell(sheet, 2, "Qty/Box")).toBe(100)
    expect(cell(sheet, 2, "Qty/Delivery")).toBe(100)
    expect(cell(sheet, 2, "Label di batch")).toBe(3)
    expect(cell(sheet, 2, "Box dibuat")).toBeInstanceOf(Date)
    expect(cell(sheet, 2, "Scan dimulai")).toBeInstanceOf(Date)
    expect(cell(sheet, 2, "Siap finalisasi")).toBeInstanceOf(Date)
    expect(cell(sheet, 2, "Difinalisasi")).toBeInstanceOf(Date)
    expect(cell(sheet, 2, "Dibatalkan")).toBeInstanceOf(Date)
    expect(cell(sheet, 2, "Alasan pembatalan")).toBe("Salah delivery")
    expect(cell(sheet, 2, "Status sesi")).toBe("Dibatalkan")
    expect(cell(sheet, 2, "ID batch")).toBe(
      "11111111-1111-4111-8111-111111111111",
    )
    expect(cell(sheet, 2, "ID sesi")).toBe("session-1")
  })

  it("leaves the session columns empty for a box that was never scanned", async () => {
    const workbook = await readBack(
      buildMasterItemHistoryWorkbook(meta, [historyRow({ session: null })]),
    )
    const sheet = workbook.getWorksheet("Batch & sesi")!

    expect(cell(sheet, 2, "Status sesi")).toBe("Belum discan")
    expect(cell(sheet, 2, "Scan dimulai")).toBeNull()
    expect(cell(sheet, 2, "ID sesi")).toBeNull()
  })

  // Tiap baris sub data membawa id barisnya sendiri supaya bisa ditelusuri
  // balik ke tabelnya di Supabase.
  it("carries the row ids of every sub level", async () => {
    const workbook = await readBack(
      buildMasterItemHistoryWorkbook(meta, [historyRow()]),
    )

    expect(cell(workbook.getWorksheet("Scan")!, 2, "ID scan")).toBe("scan-1")
    expect(cell(workbook.getWorksheet("Cetak")!, 2, "ID job")).toBe("job-1")
    expect(
      cell(workbook.getWorksheet("Percobaan cetak")!, 2, "ID percobaan"),
    ).toBe("att-1")
    expect(cell(workbook.getWorksheet("Percobaan cetak")!, 2, "ID job")).toBe(
      "job-1",
    )
  })

  it("summarises each label box on one row", async () => {
    const workbook = await readBack(
      buildMasterItemHistoryWorkbook(meta, [historyRow()]),
    )
    const sheet = workbook.getWorksheet("Label box")!

    expect(sheet.rowCount).toBe(2)
    expect(cell(sheet, 2, "Nomor Box")).toBe("B101")
    expect(cell(sheet, 2, "Delivery Number")).toBe("DN-08-2026-12599")
    expect(cell(sheet, 2, "Scan diterima")).toBe(1)
    expect(cell(sheet, 2, "Scan ditolak")).toBe(1)
    expect(cell(sheet, 2, "Status cetak terakhir")).toBe("Dikonfirmasi")
    expect(cell(sheet, 2, "Status label")).toBe("Terverifikasi")
  })

  it("writes one row per scan and per print attempt", async () => {
    const workbook = await readBack(
      buildMasterItemHistoryWorkbook(meta, [historyRow()]),
    )

    const scans = workbook.getWorksheet("Scan")!
    expect(scans.rowCount).toBe(3)
    expect(cell(scans, 3, "Hasil")).toBe("Duplikat")
    expect(cell(scans, 3, "Kode error")).toBe("LABEL_ALREADY_SCANNED")

    const attempts = workbook.getWorksheet("Percobaan cetak")!
    expect(attempts.rowCount).toBe(3)
    expect(cell(attempts, 2, "Hasil")).toBe("Gagal")
    expect(cell(attempts, 2, "Pesan error")).toBe("Gagal mengirim ke printer.")
    expect(cell(attempts, 3, "Hasil")).toBe("Terkirim")
  })

  // Waktu ditulis sebagai nilai tanggal supaya bisa diurutkan dan disaring di
  // dalam Excel; sebagai teks ia hanya terurut menurut abjad.
  it("writes timestamps as dates, not text", async () => {
    const workbook = await readBack(
      buildMasterItemHistoryWorkbook(meta, [historyRow()]),
    )
    const sheet = workbook.getWorksheet("Label box")!

    expect(cell(sheet, 2, "Batch dibuat")).toBeInstanceOf(Date)
    expect(cell(sheet, 2, "Tanggal Delivery")).toBeInstanceOf(Date)
  })

  it("leaves a box that was never scanned or printed readable", async () => {
    const workbook = await readBack(
      buildMasterItemHistoryWorkbook(meta, [
        historyRow({
          batchClosedAt: null,
          labelStatus: "generated",
          printJobs: [],
          scans: [],
          session: null,
        }),
      ]),
    )
    const sheet = workbook.getWorksheet("Label box")!

    expect(cell(sheet, 2, "Status cetak terakhir")).toBe("Belum dicetak")
    expect(cell(sheet, 2, "Status sesi")).toBe("Belum discan")
    expect(cell(sheet, 2, "Batch ditutup")).toBeNull()
    expect(workbook.getWorksheet("Scan")!.rowCount).toBe(1)
  })

  it("keeps the header row frozen and filterable on every sheet", async () => {
    const workbook = await readBack(
      buildMasterItemHistoryWorkbook(meta, [historyRow()]),
    )

    for (const sheet of workbook.worksheets) {
      expect(sheet.getRow(1).font?.bold).toBe(true)
      expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 })
      expect(sheet.autoFilter).toBeTruthy()
    }
  })

  it("still produces every sheet when there is no history at all", async () => {
    const workbook = await readBack(buildMasterItemHistoryWorkbook(meta, []))

    expect(workbook.worksheets).toHaveLength(6)
    expect(workbook.getWorksheet("Label box")!.rowCount).toBe(1)
  })
})

describe("historyExportFilename", () => {
  it("names the file after the master item and the day it was taken", () => {
    expect(
      historyExportFilename("MI-0001", new Date("2026-08-14T10:00:00Z")),
    ).toBe("riwayat-MI-0001-2026-08-14.xlsx")
  })

  // Kode item ikut ke nama berkas, dan nama berkas tidak boleh membawa garis
  // miring atau spasi yang membingungkan sistem berkas Windows.
  it("replaces characters a filename should not carry", () => {
    expect(
      historyExportFilename("MI 0001/A", new Date("2026-08-14T10:00:00Z")),
    ).toBe("riwayat-MI-0001-A-2026-08-14.xlsx")
  })

  it("names each box, each format, and each csv section apart", () => {
    const now = new Date("2026-08-14T10:00:00Z")

    expect(historyExportFilename("MI-0001", now, "pdf", ["B101"])).toBe(
      "riwayat-MI-0001-B101-2026-08-14.pdf",
    )
    expect(historyExportFilename("MI-0001", now, "csv", ["B101", "scan"])).toBe(
      "riwayat-MI-0001-B101-scan-2026-08-14.csv",
    )
  })
})

// Menu unduhan dirender di klien dari daftarnya sendiri; daftar yang melenceng
// dari perakit bagiannya menghasilkan tautan CSV yang menjawab 400.
describe("HISTORY_SECTIONS", () => {
  it("matches the sections the exporter actually builds", () => {
    expect(HISTORY_SECTIONS.map((section) => section.key)).toEqual(
      buildHistorySections([]).map((section) => section.key),
    )
    expect(HISTORY_SECTIONS.map((section) => section.name)).toEqual(
      buildHistorySections([]).map((section) => section.name),
    )
  })
})

describe("buildMasterItemHistoryCsv", () => {
  function lines(csv: string): string[] {
    return csv.trimEnd().split("\r\n")
  }

  it("writes the requested section only", () => {
    const csv = buildMasterItemHistoryCsv([historyRow()], "scan")!

    expect(lines(csv)).toHaveLength(3)
    expect(lines(csv)[0]).toContain("Label UID")
    expect(lines(csv)[2]).toContain("LABEL_ALREADY_SCANNED")
  })

  it("rejects a section that does not exist", () => {
    expect(buildMasterItemHistoryCsv([historyRow()], "tidak-ada")).toBeNull()
  })

  // Excel di Windows membaca CSV tanpa BOM sebagai ANSI, dan nama part dengan
  // karakter non-ASCII keluar rusak.
  it("starts with a UTF-8 BOM", () => {
    expect(buildMasterItemHistoryCsv([], "label-box")!.startsWith("﻿")).toBe(
      true,
    )
  })

  // ISO 8601, bukan format lokal: "12-08-2026" tidak bisa dibedakan dari
  // "08-12-2026" oleh alat yang membaca berkasnya.
  it("writes dates as ISO 8601 and leaves empty cells empty", () => {
    const csv = buildMasterItemHistoryCsv(
      [historyRow({ batchClosedAt: null })],
      "label-box",
    )!
    const row = lines(csv)[1]

    expect(row).toContain("2026-08-26")
    expect(row).toContain("2026-08-12T02:00:00.000Z")
    expect(row.endsWith(",")).toBe(true)
  })

  it("quotes a value that carries the delimiter", () => {
    const csv = buildMasterItemHistoryCsv(
      [historyRow({ lotNo: 'CRT,08"28' })],
      "label-box",
    )!

    expect(lines(csv)[1]).toContain('"CRT,08""28"')
  })

  // Sebagian isi kolom berasal dari hasil scan di lapangan, dan Excel membaca
  // sel yang diawali "=" sebagai rumus.
  it("keeps a cell that looks like a formula as text", () => {
    const csv = buildMasterItemHistoryCsv(
      [historyRow({ lotNo: "=1+1" })],
      "label-box",
    )!

    expect(lines(csv)[1]).toContain("'=1+1")
  })
})

describe("buildLabelBoxHistoryPdf", () => {
  const now = new Date("2026-08-14T10:00:00Z")

  it("produces a pdf document for one box", async () => {
    const pdf = await buildLabelBoxHistoryPdf(meta, historyRow(), now)

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
    expect(pdf.byteLength).toBeGreaterThan(1000)
  })

  it("still produces a document for a box that was never scanned or printed", async () => {
    const pdf = await buildLabelBoxHistoryPdf(
      meta,
      historyRow({ printJobs: [], scans: [], session: null }),
      now,
    )

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
  })

  // Ratusan scan harus tumpah ke halaman berikutnya, bukan menumpuk di kaki
  // halaman pertama.
  it("breaks into more pages as the scan list grows", async () => {
    const base = historyRow()
    const many = historyRow({
      scans: Array.from({ length: 300 }, (_, index) => ({
        ...base.scans[0],
        id: `scan-${index}`,
      })),
    })

    const short = await buildLabelBoxHistoryPdf(meta, base, now)
    const long = await buildLabelBoxHistoryPdf(meta, many, now)

    expect(long.byteLength).toBeGreaterThan(short.byteLength * 2)
  })
})
