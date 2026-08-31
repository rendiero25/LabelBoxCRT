/** Bentuk satu baris balikan verify_delivery_label yang dipakai pesannya. */
export type ScanMessageRow = {
  packing_qty: number | null
  part_no: string | null
  product_size: string | null
  qty_delivery: number | null
  remaining_qty: number | null
  result: string
  row_done: boolean | null
  size_complete: boolean | null
  verified_boxes: number | null
  verified_qty: number | null
}

/**
 * Kalimat yang dibaca operator sesudah satu tembakan.
 *
 * Berdiri di modulnya sendiri, bukan di actions.ts, karena berkas `"use
 * server"` hanya boleh mengekspor fungsi async -- dan kalimat inilah satu-
 * satunya bagian verifikasi yang bisa diuji tanpa database.
 *
 * Yang paling dibutuhkan operator adalah sisa kepingnya: berapa box yang
 * dipakai tidak diatur, jadi ia tidak bisa menghitung sendiri kapan berhenti.
 * Jumlah box ikut disebut sebagai keterangan, bukan sebagai target.
 */
export function scanMessage(row: ScanMessageRow): string {
  if (row.result === "unknown_label") {
    return "NOT PASS — QR tidak terbaca: ukuran atau Qty tidak ditemukan di dalamnya."
  }

  // "PASS" hanya untuk baris yang totalnya sudah lengkap. Scan yang diterima
  // tetapi belum menutup kirimannya cuma melaporkan kemajuan: menyebutnya PASS
  // membuat operator mengira ukuran itu sudah beres padahal box-nya masih ada
  // di palet.
  if (row.result === "pass") {
    if (row.row_done) {
      return `PASS — ${row.product_size} lengkap ${row.qty_delivery} pcs dalam ${row.verified_boxes} box.`
    }

    return `${row.product_size} ${row.verified_qty}/${row.qty_delivery} pcs, ${row.verified_boxes} box. Sisa ${row.remaining_qty} pcs.`
  }

  // Ukuran yang sudah cukup dibedakan dari Qty yang kebesaran: yang pertama
  // berarti operator mengambil box berlebih, yang kedua berarti box yang
  // dipegang tidak muat pada sisa baris itu.
  if (row.size_complete) {
    return `NOT PASS — ${row.part_no} sudah lengkap ${row.qty_delivery} pcs.`
  }

  if (row.remaining_qty) {
    return `NOT PASS — ${row.part_no} sisa ${row.remaining_qty} pcs, QR ini ${row.packing_qty} pcs.`
  }

  return `NOT PASS — tidak ada baris jadwal untuk ${row.part_no} (Qty ${row.packing_qty}).`
}
