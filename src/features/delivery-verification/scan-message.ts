/** Bentuk satu baris balikan verify_delivery_label yang dipakai pesannya. */
export type ScanMessageRow = {
  expected_boxes: number | null
  full_box_qty: number | null
  last_box_qty: number | null
  packing_qty: number | null
  part_no: string | null
  product_size: string | null
  result: string
  row_done: boolean | null
  size_complete: boolean | null
  verified_boxes: number | null
}

/**
 * Kalimat yang dibaca operator sesudah satu tembakan.
 *
 * Berdiri di modulnya sendiri, bukan di actions.ts, karena berkas `"use
 * server"` hanya boleh mengekspor fungsi async -- dan kalimat inilah satu-
 * satunya bagian verifikasi yang bisa diuji tanpa database.
 *
 * Isinya menyebut kenapa, bukan cuma PASS atau NOT PASS. Sejak satu baris
 * jadwal berisi beberapa box, yang paling dibutuhkan operator adalah sisa
 * box-nya: tanpa itu ia harus mengingat sendiri sudah berapa kali ukuran yang
 * sama ditembak. Dan penolakan menyebut Qty yang seharusnya -- operator yang
 * cuma diberi "NOT PASS" akan menembak ulang label yang sama alih-alih
 * mengambil box yang benar.
 */
export function scanMessage(row: ScanMessageRow): string {
  if (row.result === "unknown_label") {
    return "NOT PASS — QR tidak terbaca: ukuran atau Qty tidak ditemukan di dalamnya."
  }

  const expected = row.expected_boxes ?? 0
  const verified = row.verified_boxes ?? 0

  if (row.result === "pass") {
    if (row.row_done) {
      return `PASS — ${row.product_size} lengkap ${expected}/${expected} box.`
    }

    return `PASS — ${row.product_size} box ${verified}/${expected}, Qty ${row.packing_qty}. Sisa ${expected - verified} box.`
  }

  // Ukuran yang sudah cukup dibedakan dari ukuran yang salah Qty-nya: yang
  // pertama berarti operator mengambil box berlebih, yang kedua berarti
  // labelnya tidak sesuai isi box.
  if (row.size_complete) {
    return `NOT PASS — ${row.part_no} sudah lengkap ${expected} box.`
  }

  if (row.full_box_qty) {
    const lastBox = row.last_box_qty
      ? ` (box terakhir ${row.last_box_qty})`
      : ""
    return `NOT PASS — ${row.part_no} butuh Qty ${row.full_box_qty} per box${lastBox}, QR ini ${row.packing_qty}.`
  }

  return `NOT PASS — tidak ada baris jadwal untuk ${row.part_no} (Qty ${row.packing_qty}).`
}
