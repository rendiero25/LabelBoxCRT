import { describe, expect, it } from "vitest"

import {
  scanMessage,
  type ScanMessageRow,
} from "@/features/delivery-verification/scan-message"

/** Kiriman 5000 yang baru menerima satu box 2000. */
function row(overrides: Partial<ScanMessageRow> = {}): ScanMessageRow {
  return {
    packing_qty: 2000,
    part_no: "VS-B T0.3XW60 L=225MM",
    product_size: "VS-B T0.3XW60 L=225MM",
    qty_delivery: 5000,
    remaining_qty: 3000,
    result: "pass",
    row_done: false,
    size_complete: false,
    verified_boxes: 1,
    verified_qty: 2000,
    ...overrides,
  }
}

describe("scanMessage", () => {
  /**
   * Sisa keping adalah satu-satunya angka yang tidak bisa dihitung operator
   * sendiri: berapa box yang dipakai tidak diatur, jadi ia tidak punya cara
   * tahu kapan berhenti selain diberi tahu.
   */
  it("says how many pieces are left after an accepted box", () => {
    expect(scanMessage(row())).toBe(
      "PASS — VS-B T0.3XW60 L=225MM 2000/5000 pcs, 1 box. Sisa 3000 pcs.",
    )
  })

  it("announces the row as complete with the box count it took", () => {
    expect(
      scanMessage(
        row({
          remaining_qty: 0,
          row_done: true,
          verified_boxes: 3,
          verified_qty: 5000,
        }),
      ),
    ).toBe("PASS — VS-B T0.3XW60 L=225MM lengkap 5000 pcs dalam 3 box.")
  })

  /**
   * Box yang tidak muat pada sisa ditolak, dan sisanya disebut. Tanpa angka
   * itu operator tidak tahu apakah ia salah ambil box atau salah baris.
   */
  it("names the remainder when a box does not fit", () => {
    expect(scanMessage(row({ packing_qty: 4000, result: "not_pass" }))).toBe(
      "NOT PASS — VS-B T0.3XW60 L=225MM sisa 3000 pcs, QR ini 4000 pcs.",
    )
  })

  /**
   * Ukuran yang sudah cukup dibedakan dari box yang kebesaran: yang pertama
   * berarti kiriman sudah lengkap, yang kedua berarti box-nya salah. Keduanya
   * menuntut tindakan berbeda.
   */
  it("separates an already-complete size from a box that does not fit", () => {
    expect(
      scanMessage(
        row({ remaining_qty: 0, result: "not_pass", size_complete: true }),
      ),
    ).toBe("NOT PASS — VS-B T0.3XW60 L=225MM sudah lengkap 5000 pcs.")
  })

  it("says the size is not scheduled at all when no row carries it", () => {
    expect(
      scanMessage(
        row({
          qty_delivery: null,
          remaining_qty: null,
          result: "not_pass",
          verified_boxes: null,
          verified_qty: null,
        }),
      ),
    ).toBe(
      "NOT PASS — tidak ada baris jadwal untuk VS-B T0.3XW60 L=225MM (Qty 2000).",
    )
  })

  it("reports an unreadable QR before anything about quantities", () => {
    expect(scanMessage(row({ result: "unknown_label" }))).toBe(
      "NOT PASS — QR tidak terbaca: ukuran atau Qty tidak ditemukan di dalamnya.",
    )
  })
})
