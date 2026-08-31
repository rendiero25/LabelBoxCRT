import { describe, expect, it } from "vitest"

import {
  scanMessage,
  type ScanMessageRow,
} from "@/features/delivery-verification/scan-message"

/**
 * Kasus dari lantai produksi: baris ber-Qty Delivery 2000 yang Box-nya diisi 2,
 * dan keduanya membawa label yang sama berisi 2000.
 */
function row(overrides: Partial<ScanMessageRow> = {}): ScanMessageRow {
  return {
    boxes_unset: false,
    expected_boxes: 2,
    expected_qty: null,
    packing_qty: 2000,
    part_no: "VS-B T0.3XW60 L=225MM",
    product_size: "VS-B T0.3XW60 L=225MM",
    result: "pass",
    row_done: false,
    size_complete: false,
    verified_boxes: 1,
    ...overrides,
  }
}

describe("scanMessage", () => {
  /**
   * Sisa box adalah satu-satunya angka yang tidak bisa dihitung operator
   * sendiri. Semua box berlabel sama, jadi tanpa ini ia harus mengingat sudah
   * berapa kali label yang sama ditembak -- dan kalimatnya menyuruh menembak
   * label yang sama, bukan mencari label lain.
   */
  it("says how many boxes are left and that the same label is scanned again", () => {
    expect(scanMessage(row())).toBe(
      "PASS — VS-B T0.3XW60 L=225MM box 1/2. Sisa 1 box, tembak label yang sama.",
    )
  })

  it("announces the row as complete on its last box", () => {
    expect(scanMessage(row({ row_done: true, verified_boxes: 2 }))).toBe(
      "PASS — VS-B T0.3XW60 L=225MM lengkap 2/2 box.",
    )
  })

  /**
   * Qty yang dijadwalkan ikut disebut. Itu yang memisahkan dua kiriman
   * berukuran sama dengan jumlah berbeda, dan operator perlu tahu ia sedang
   * memegang label kiriman yang lain.
   */
  it("names the scheduled Qty when a label does not match it", () => {
    expect(
      scanMessage(
        row({ expected_qty: 2000, packing_qty: 1500, result: "not_pass" }),
      ),
    ).toBe(
      "NOT PASS — VS-B T0.3XW60 L=225MM dijadwalkan Qty 2000, QR ini 1500.",
    )
  })

  /**
   * Box berlebih dibedakan dari Qty yang salah: yang pertama berarti kiriman
   * sudah cukup, yang kedua berarti labelnya bukan milik baris ini. Keduanya
   * menuntut tindakan berbeda.
   */
  it("separates an already-complete size from a wrong Qty", () => {
    expect(scanMessage(row({ result: "not_pass", size_complete: true }))).toBe(
      "NOT PASS — VS-B T0.3XW60 L=225MM sudah lengkap 2 box.",
    )
  })

  /**
   * Baris yang jumlah box-nya belum diisi tidak bisa ditolong dengan menembak
   * ulang: yang kurang isian di layar, dan tempatnya kolom Box baris itu.
   */
  it("points at the Box column when the count has not been filled in", () => {
    expect(
      scanMessage(
        row({ boxes_unset: true, expected_boxes: null, result: "not_pass" }),
      ),
    ).toBe(
      "NOT PASS — VS-B T0.3XW60 L=225MM belum diisi jumlah box-nya. Isi kolom Box dulu.",
    )
  })

  it("says the size is not scheduled at all when no row carries it", () => {
    expect(scanMessage(row({ expected_boxes: null, result: "not_pass" }))).toBe(
      "NOT PASS — tidak ada baris jadwal untuk VS-B T0.3XW60 L=225MM (Qty 2000).",
    )
  })

  it("reports an unreadable QR before anything about boxes", () => {
    expect(scanMessage(row({ result: "unknown_label" }))).toBe(
      "NOT PASS — QR tidak terbaca: ukuran atau Qty tidak ditemukan di dalamnya.",
    )
  })
})
