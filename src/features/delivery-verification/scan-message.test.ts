import { describe, expect, it } from "vitest"

import {
  scanMessage,
  type ScanMessageRow,
} from "@/features/delivery-verification/scan-message"

/** Baris B dari contoh lantai produksi: 7000 keping, MPQ 1500, jadi 5 box. */
function row(overrides: Partial<ScanMessageRow> = {}): ScanMessageRow {
  return {
    expected_boxes: 5,
    full_box_qty: null,
    last_box_qty: null,
    packing_qty: 1500,
    part_no: "VS-B T0.3XW60 L=110MM",
    product_size: "VS-B T0.3XW60 L=110MM",
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
   * sendiri sambil membongkar palet. Tanpa itu ia harus mengingat sudah berapa
   * kali ukuran yang sama ditembak.
   */
  it("says how many boxes are left after an accepted scan", () => {
    expect(scanMessage(row())).toBe(
      "PASS — VS-B T0.3XW60 L=110MM box 1/5, Qty 1500. Sisa 4 box.",
    )
  })

  it("announces the row as complete on its last box", () => {
    expect(scanMessage(row({ row_done: true, verified_boxes: 5 }))).toBe(
      "PASS — VS-B T0.3XW60 L=110MM lengkap 5/5 box.",
    )
  })

  /**
   * Qty yang seharusnya ikut disebut, termasuk Qty box terakhir yang berbeda.
   * "NOT PASS" belaka membuat operator menembak ulang label yang sama alih-alih
   * mengambil box yang benar.
   */
  it("names the Qty a box must carry when one is rejected", () => {
    expect(
      scanMessage(
        row({
          full_box_qty: 1500,
          last_box_qty: 1000,
          packing_qty: 1200,
          result: "not_pass",
        }),
      ),
    ).toBe(
      "NOT PASS — VS-B T0.3XW60 L=110MM butuh Qty 1500 per box (box terakhir 1000), QR ini 1200.",
    )
  })

  it("leaves out the last box when the delivery divides evenly", () => {
    expect(
      scanMessage(
        row({
          expected_boxes: 4,
          full_box_qty: 2000,
          last_box_qty: null,
          packing_qty: 999,
          result: "not_pass",
        }),
      ),
    ).toBe(
      "NOT PASS — VS-B T0.3XW60 L=110MM butuh Qty 2000 per box, QR ini 999.",
    )
  })

  /**
   * Box berlebih dibedakan dari Qty yang salah: yang pertama berarti kiriman
   * sudah cukup dan operator mengambil satu box kelebihan, yang kedua berarti
   * labelnya tidak sesuai isi box. Keduanya menuntut tindakan berbeda.
   */
  it("separates an already-complete size from a wrong Qty", () => {
    expect(scanMessage(row({ result: "not_pass", size_complete: true }))).toBe(
      "NOT PASS — VS-B T0.3XW60 L=110MM sudah lengkap 5 box.",
    )
  })

  it("says the size is not scheduled at all when no row carries it", () => {
    expect(
      scanMessage(
        row({ expected_boxes: null, packing_qty: 2000, result: "not_pass" }),
      ),
    ).toBe(
      "NOT PASS — tidak ada baris jadwal untuk VS-B T0.3XW60 L=110MM (Qty 2000).",
    )
  })

  it("reports an unreadable QR before anything about boxes", () => {
    expect(scanMessage(row({ result: "unknown_label" }))).toBe(
      "NOT PASS — QR tidak terbaca: ukuran atau Qty tidak ditemukan di dalamnya.",
    )
  })
})
