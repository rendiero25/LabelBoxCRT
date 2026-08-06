import { describe, expect, it } from "vitest"

import {
  formatLabelFields,
  formatShortDate,
  type FinalizedLabelSnapshot,
} from "@/lib/label/formatter"

const baseSnapshot: FinalizedLabelSnapshot = {
  supplierCode: "10015",
  partNo: "3210A-K1Z-NA01-DL",
  packingQty: 100,
  qtyDelivery: 200,
  masterItemRowNo: 1,
  lotNo: "M-CRT-004A-581-300726-B001",
  boxNumber: "B101",
  deliveryDate: "2026-08-15",
  qrPayload: "10015|3210A-K1Z-NA01-DL|100|1|LOT-A|B101|15-08-2026",
}

describe("formatLabelFields", () => {
  it("maps a snapshot to the eight rows printed on the label", () => {
    expect(formatLabelFields(baseSnapshot)).toEqual({
      supplierCode: "10015",
      partNo: "3210A-K1Z-NA01-DL",
      packingQty: "100",
      qtyDelivery: "200",
      masterItemRowNo: "1",
      lotNo: "M-CRT-004A-581-300726-B001",
      boxNumber: "B101",
      deliveryDate: "15-08-2026",
      deliveryMonth: "8",
      qrPayload: "10015|3210A-K1Z-NA01-DL|100|1|LOT-A|B101|15-08-2026",
    })
  })

  // Angka bulan besar di label dibaca sebagai penanda FIFO, jadi ia harus
  // selalu bulan yang sama dengan baris Delivery Date, bukan bulan berjalan.
  // Januari sampai September satu digit; nol di depan dibuang.
  it.each([
    ["1", "2026-01-01"],
    ["8", "2026-08-15"],
    ["9", "2026-09-30"],
    ["10", "2026-10-01"],
    ["12", "2026-12-31"],
  ])(
    "takes deliveryMonth %s from the delivery date %s",
    (expected, isoDate) => {
      expect(
        formatLabelFields({ ...baseSnapshot, deliveryDate: isoDate })
          .deliveryMonth,
      ).toBe(expected)
    },
  )

  // Qty/Box adalah packing qty Master Item, Qty/Delivery adalah jumlah kiriman.
  // Keduanya angka dan bersebelahan di label, jadi tertukarnya tidak kelihatan.
  it("keeps packing qty and delivery qty on their own rows", () => {
    const result = formatLabelFields({
      ...baseSnapshot,
      packingQty: 50,
      qtyDelivery: 1500,
    })
    expect(result.packingQty).toBe("50")
    expect(result.qtyDelivery).toBe("1500")
  })

  it("formats quantities as plain digits with no thousands separator", () => {
    expect(
      formatLabelFields({ ...baseSnapshot, qtyDelivery: 12345 }).qtyDelivery,
    ).toBe("12345")
  })

  it.each([
    ["01-01-2026", "2026-01-01"],
    ["15-08-2026", "2026-08-15"],
    ["31-12-2026", "2026-12-31"],
    ["29-02-2024", "2024-02-29"],
  ])("formats deliveryDate as %s for input %s", (expected, isoDate) => {
    expect(
      formatLabelFields({ ...baseSnapshot, deliveryDate: isoDate })
        .deliveryDate,
    ).toBe(expected)
  })

  it("does not truncate a long Part No or Lot No", () => {
    const longPartNo = "PN-".padEnd(65, "X")
    const longLotNo = "M-CRT-".padEnd(70, "9")

    const result = formatLabelFields({
      ...baseSnapshot,
      lotNo: longLotNo,
      partNo: longPartNo,
    })
    expect(result.partNo).toBe(longPartNo)
    expect(result.lotNo).toBe(longLotNo)
  })

  it("throws when deliveryDate is not a parseable ISO date", () => {
    expect(() =>
      formatLabelFields({ ...baseSnapshot, deliveryDate: "15-05-2026" }),
    ).toThrow()
  })

  it("passes the stored QR payload through untouched", () => {
    expect(formatLabelFields(baseSnapshot).qrPayload).toBe(
      "10015|3210A-K1Z-NA01-DL|100|1|LOT-A|B101|15-08-2026",
    )
  })
})

describe("formatShortDate", () => {
  it("formats an ISO date as DD-MM-YYYY", () => {
    expect(formatShortDate("2026-07-28")).toBe("28-07-2026")
  })

  it("accepts a full ISO timestamp", () => {
    expect(formatShortDate("2026-12-31T23:59:59.123Z")).toBe("31-12-2026")
  })

  it("throws when the value is not an ISO date", () => {
    expect(() => formatShortDate("28/07/2026")).toThrow()
  })
})
