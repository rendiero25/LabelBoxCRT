export type LabelBoxMasterItemOption = {
  /**
   * Master Item tanpa Box tidak bisa dipakai membuat label box: jumlah label
   * dihitung dari Qty Delivery dibagi Packing Qty lalu dikali jumlah Box, dan
   * nol Box berarti nol label (`MASTER_ITEM_HAS_NO_BOX` di RPC-nya).
   *
   * Dulu Master Item seperti itu dibuang dari daftar, dan operator melihat
   * daftar yang lebih pendek daripada daftar Master Item di halaman admin tanpa
   * satu pun keterangan kenapa. Sekarang barisnya tetap ada, dinonaktifkan
   * beserta alasannya.
   */
  hasBox: boolean
  id: string
  itemCode: string
  packingQty: number
  partNo: string
  supplierId: string | null
}

type MasterItemRow = {
  default_label_qty: number
  id: string
  item_code: string
  part_no: string
  supplier_id: string | null
}

/**
 * Pilihan Master Item untuk formulir label box, seluruhnya — bukan hanya yang
 * sudah punya Box. Urutannya mengikuti urutan baris yang masuk, yaitu urutan
 * item_code yang sama dengan halaman admin.
 */
export function toLabelBoxMasterItemOptions(
  masterItems: MasterItemRow[],
  boxes: { master_item_id: string }[],
): LabelBoxMasterItemOption[] {
  const withBox = new Set(boxes.map((box) => box.master_item_id))

  return masterItems.map((item) => ({
    hasBox: withBox.has(item.id),
    id: item.id,
    itemCode: item.item_code,
    packingQty: item.default_label_qty,
    partNo: item.part_no,
    supplierId: item.supplier_id,
  }))
}
