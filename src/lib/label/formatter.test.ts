import { describe, expect, it } from "vitest"

import {
  formatLabelFields,
  formatShortDate,
  type FinalizedLabelSnapshot,
} from "@/lib/label/formatter"

const baseSnapshot: FinalizedLabelSnapshot = {
  supplierCode: "10015",
  supplierName: "PT SUMBER KABEL",
  partNo: "3210A-K1Z-NA01-DL",
  packingQty: 100,
  qtyDelivery: 200,
  masterItemRowNo: 1,
  lotNo: "M-CRT-004A-581-300726-B001",
  operatorName: "Andi",
  boxNumber: "B101",
  packingDate: "2026-08-05",
  deliveryDate: "2026-08-15",
  qrPayload: "10015|3210A-K1Z-NA01-DL|100|1-LOT-A-B101|15-AUG-2026",
}

describe("formatLabelFields", () => {
  it("maps a snapshot to the rows printed on the label", () => {
    expect(formatLabelFields(baseSnapshot)).toEqual({
      supplierCode: "10015",
      supplierName: "PT SUMBER KABEL",
      partNo: "3210A-K1Z-NA01-DL",
      packingQty: "100 pcs",
      qtyDelivery: "200 pcs",
      lotNo: "01-M-CRT-004A-581-300726-B001-B101",
      operatorName: "Andi",
      packingDate: "05-AUG-2026",
      deliveryDate: "15-AUG-2026",
      deliveryMonth: "8",
      qrPayload: "10015|3210A-K1Z-NA01-DL|100|1-LOT-A-B101|15-AUG-2026",
    })
  })

  // Nomor urut Master Item, Lot No, dan nomor box dulu punya barisnya
  // masing-masing. Sekarang ketiganya satu baris, jadi urutan dan pemisahnya
  // yang membuat operator bisa membacanya kembali sebagai tiga hal berbeda.
  it("prefixes the master item row number to two digits", () => {
    expect(
      formatLabelFields({ ...baseSnapshot, masterItemRowNo: 7 }).lotNo,
    ).toBe("07-M-CRT-004A-581-300726-B001-B101")
  })

  // Memotong nomor di atas 99 akan menunjuk item yang salah; lebar barisnya
  // yang mengalah, bukan angkanya.
  it("leaves a row number past 99 at its full length", () => {
    expect(
      formatLabelFields({ ...baseSnapshot, masterItemRowNo: 128 }).lotNo,
    ).toBe("128-M-CRT-004A-581-300726-B001-B101")
  })

  it("takes the box number from the snapshot into the Lot No line", () => {
    expect(
      formatLabelFields({ ...baseSnapshot, boxNumber: "B302" }).lotNo,
    ).toBe("01-M-CRT-004A-581-300726-B001-B302")
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
    expect(result.packingQty).toBe("50 pcs")
    expect(result.qtyDelivery).toBe("1500 pcs")
  })

  // Ribuan tanpa pemisah: titik atau koma di label akan terbaca sebagai koma
  // desimal oleh sebagian operator.
  it("formats quantities as plain digits with no thousands separator", () => {
    expect(
      formatLabelFields({ ...baseSnapshot, qtyDelivery: 12345 }).qtyDelivery,
    ).toBe("12345 pcs")
  })

  it.each([
    ["01-JAN-2026", "2026-01-01"],
    ["15-AUG-2026", "2026-08-15"],
    ["31-DEC-2026", "2026-12-31"],
    ["29-FEB-2024", "2024-02-29"],
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
    expect(result.lotNo).toContain(longLotNo)
  })

  // Satu kolom yang null di RPC — atau belum ada karena migrasinya belum
  // jalan — hanya boleh mengosongkan barisnya. Sebelumnya nilai undefined itu
  // menjatuhkan perender HTML dan seluruh lembar cetak ikut gagal.
  it("renders a missing snapshot field as an empty row instead of throwing", () => {
    const incomplete = {
      ...baseSnapshot,
      supplierName: undefined,
    } as unknown as FinalizedLabelSnapshot

    expect(formatLabelFields(incomplete).supplierName).toBe("")
  })

  it("throws when deliveryDate is not a parseable ISO date", () => {
    expect(() =>
      formatLabelFields({ ...baseSnapshot, deliveryDate: "15-05-2026" }),
    ).toThrow()
  })

  // Baris Operator Pack dulu teks tetap di templat; sekarang datang dari batch,
  // jadi nilainya harus sampai apa adanya ke perender label.
  it("carries the operator name from the snapshot to the label rows", () => {
    expect(
      formatLabelFields({ ...baseSnapshot, operatorName: "Siti Rahayu" })
        .operatorName,
    ).toBe("Siti Rahayu")
  })

  it("passes the stored QR payload through untouched", () => {
    expect(formatLabelFields(baseSnapshot).qrPayload).toBe(
      "10015|3210A-K1Z-NA01-DL|100|1-LOT-A-B101|15-AUG-2026",
    )
  })
})

describe("formatShortDate", () => {
  it("formats an ISO date as DD-MMM-YYYY", () => {
    expect(formatShortDate("2026-07-28")).toBe("28-JUL-2026")
  })

  it("accepts a full ISO timestamp", () => {
    expect(formatShortDate("2026-12-31T23:59:59.123Z")).toBe("31-DEC-2026")
  })

  // Kembaran dari private.label_date_text di Postgres, yang merakit tanggal di
  // dalam QR payload. Keempat bulan ini yang ejaannya berbeda dari singkatan
  // Indonesia yang dipakai sebelumnya; kalau salah satu meleset, label dan
  // QR-nya menyebut bulan dengan dua cara berbeda.
  it.each([
    ["01-MAY-2026", "2026-05-01"],
    ["18-AUG-2026", "2026-08-18"],
    ["09-OCT-2026", "2026-10-09"],
    ["25-DEC-2026", "2026-12-25"],
  ])("matches the Postgres month abbreviation %s", (expected, isoDate) => {
    expect(formatShortDate(isoDate)).toBe(expected)
  })

  it("throws when the value is not an ISO date", () => {
    expect(() => formatShortDate("28/07/2026")).toThrow()
  })
})
