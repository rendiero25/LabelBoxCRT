import ExcelJS from "exceljs"
import { describe, expect, it } from "vitest"

import { parseScheduleWorkbook } from "@/features/delivery-verification/schedule-excel"

/**
 * Workbook dirakit di sini, bukan disimpan sebagai file contoh: yang diuji
 * adalah bentuk dokumen yang ditemui parser, dan tiap bentuk itu jadi lebih
 * jelas dibaca sebagai daftar sel daripada sebagai berkas biner.
 */
async function workbookBuffer(
  rows: (string | number | null)[][],
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Schedule")
  for (const row of rows) sheet.addRow(row)
  const buffer = await workbook.xlsx.writeBuffer()
  return buffer as ArrayBuffer
}

describe("parseScheduleWorkbook", () => {
  it("reads Part No and Qty from a plain two-column sheet", async () => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        ["Part No", "Qty"],
        ["TB 3210A-K1Z-NF01-DL", 5000],
        ["3210A-K1Z-NA01-DL", 300],
      ]),
    )

    expect(result).toEqual({
      ok: true,
      rows: [
        { partNo: "TB 3210A-K1Z-NF01-DL", qty: "5000" },
        { partNo: "3210A-K1Z-NA01-DL", qty: "300" },
      ],
    })
  })

  it("reads a file that carries a single row", async () => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        ["Part No", "Qty"],
        ["TB 3210A-K1Z-NF01-DL", 5000],
      ]),
    )

    expect(result.ok && result.rows).toHaveLength(1)
  })

  // Dokumen jadwal lazim berkop sebelum tabelnya mulai, jadi header tidak bisa
  // dipatok di baris pertama.
  it("finds the header below a document letterhead", async () => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        ["PT. CRT KABELITA", null],
        ["Schedule Delivery", null],
        ["19-AUG-2026", null],
        [null, null],
        ["Part No", "Qty"],
        ["TB 3210A-K1Z-NF01-DL", 5000],
      ]),
    )

    expect(result.ok && result.rows).toEqual([
      { partNo: "TB 3210A-K1Z-NF01-DL", qty: "5000" },
    ])
  })

  // Tiap variasi ejaan tidak boleh butuh cabangnya sendiri di parser.
  it.each([
    ["PART_NO", "QTY"],
    ["Part Number", "Quantity"],
    ["part-no", "Qty Delivery"],
    ["No Part", "Jumlah"],
  ])("accepts the header spelled %s / %s", async (partHeader, qtyHeader) => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        [partHeader, qtyHeader],
        ["TB 3210A-K1Z-NF01-DL", 5000],
      ]),
    )

    expect(result.ok && result.rows).toEqual([
      { partNo: "TB 3210A-K1Z-NF01-DL", qty: "5000" },
    ])
  })

  it("ignores columns that sit between Part No and Qty", async () => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        ["No", "Part No", "Part Name", "Qty"],
        [1, "TB 3210A-K1Z-NF01-DL", "Tube Assy", 5000],
      ]),
    )

    expect(result.ok && result.rows).toEqual([
      { partNo: "TB 3210A-K1Z-NF01-DL", qty: "5000" },
    ])
  })

  // Baris kosong pemisah, subtotal, dan catatan kaki bukan kiriman.
  it("skips rows that carry no Part No", async () => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        ["Part No", "Qty"],
        ["TB 3210A-K1Z-NF01-DL", 5000],
        [null, null],
        [null, 5000],
        ["3210A-K1Z-NA01-DL", 300],
      ]),
    )

    expect(result.ok && result.rows).toHaveLength(2)
  })

  it.each([
    ["5.000", "5000"],
    ["5,000", "5000"],
    ["5000 pcs", "5000"],
    ["  300  ", "300"],
    ["0300", "300"],
  ])("reads the quantity written as %s", async (written, expected) => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        ["Part No", "Qty"],
        ["TB 3210A-K1Z-NF01-DL", written],
      ]),
    )

    expect(result.ok && result.rows[0].qty).toBe(expected)
  })

  // Part No yang ada tapi Qty-nya tidak terbaca menggagalkan seluruh file.
  // Melewatinya berarti kiriman hilang dari jadwal tanpa ada yang tahu, dan itu
  // baru ketahuan ketika labelnya tidak punya baris untuk dicocokkan.
  it.each([
    ["", "kosong"],
    ["5000.4", "pecahan"],
    ["lima ribu", "kata"],
  ])("fails the whole file when a quantity is %s", async (written) => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        ["Part No", "Qty"],
        ["TB 3210A-K1Z-NF01-DL", written],
      ]),
    )

    expect(result.ok).toBe(false)
    expect(!result.ok && result.code).toBe("SCHEDULE_QTY_INVALID")
  })

  it("reports a missing header instead of guessing the columns", async () => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([
        ["Kode", "Banyak"],
        ["TB 3210A-K1Z-NF01-DL", 5000],
      ]),
    )

    expect(!result.ok && result.code).toBe("SCHEDULE_HEADER_NOT_FOUND")
  })

  it("reports a header with no rows under it", async () => {
    const result = await parseScheduleWorkbook(
      await workbookBuffer([["Part No", "Qty"]]),
    )

    expect(!result.ok && result.code).toBe("SCHEDULE_NO_ROWS")
  })

  it("reports an unreadable file rather than throwing", async () => {
    const notAWorkbook = new TextEncoder().encode("bukan file excel")
    const result = await parseScheduleWorkbook(
      notAWorkbook.buffer as ArrayBuffer,
    )

    expect(!result.ok && result.code).toBe("SCHEDULE_FILE_UNREADABLE")
  })
})
