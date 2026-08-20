import { describe, expect, it } from "vitest"

import { toLabelBoxMasterItemOptions } from "@/features/label-boxes/master-item-options"

const masterItems = [
  {
    default_label_qty: 100,
    id: "item-a",
    item_code: "mstritem-51",
    part_no: "TB 3210A-K1Z-NF01-DL",
    supplier_id: "supplier-1",
  },
  {
    default_label_qty: 50,
    id: "item-b",
    item_code: "mstritem-52",
    part_no: "TB 3210A-K1Z-NC01-DL",
    supplier_id: "supplier-1",
  },
]

describe("toLabelBoxMasterItemOptions", () => {
  // Inti perbaikannya: daftar di formulir label box dulu membuang Master Item
  // yang belum punya Box, jadi operator melihat daftar yang lebih pendek
  // daripada daftar Master Item di halaman admin tanpa keterangan apa pun.
  it("keeps every master item, including those without a box", () => {
    const options = toLabelBoxMasterItemOptions(masterItems, [
      { master_item_id: "item-a" },
    ])

    expect(options.map((option) => option.id)).toEqual(["item-a", "item-b"])
  })

  it("marks which master item already has a box", () => {
    const options = toLabelBoxMasterItemOptions(masterItems, [
      { master_item_id: "item-a" },
      { master_item_id: "item-a" },
    ])

    expect(options.map((option) => option.hasBox)).toEqual([true, false])
  })

  it("maps the packing qty and supplier the form filters on", () => {
    const [option] = toLabelBoxMasterItemOptions(masterItems, [])

    expect(option).toEqual({
      hasBox: false,
      id: "item-a",
      itemCode: "mstritem-51",
      packingQty: 100,
      partNo: "TB 3210A-K1Z-NF01-DL",
      supplierId: "supplier-1",
    })
  })

  // Master Item tanpa supplier ditawarkan untuk supplier mana pun, jadi
  // supplierId null harus tetap null dan tidak berubah jadi string kosong.
  it("keeps a master item without a supplier at null", () => {
    const [option] = toLabelBoxMasterItemOptions(
      [{ ...masterItems[0], supplier_id: null }],
      [],
    )

    expect(option.supplierId).toBeNull()
  })
})
