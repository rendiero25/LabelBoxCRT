import { describe, expect, it } from "vitest"

import {
  masterItemRpcErrorMessage,
  parseMasterItemInput,
} from "@/features/master-items/validation"

describe("parseMasterItemInput", () => {
  it("normalizes identifiers and preserves the default label quantity", () => {
    const formData = new FormData()
    formData.set("partNo", " 3210a-k1z-na01-dl ")
    formData.set("partName", " Tube Assy ")
    formData.set("unit", " pcs ")
    formData.set("defaultLabelQty", "100")
    formData.set("itemSequenceCode", " line-a ")

    expect(parseMasterItemInput(formData)).toEqual({
      data: {
        partNo: "3210A-K1Z-NA01-DL",
        partName: "Tube Assy",
        unit: "Pcs",
        defaultLabelQty: 100,
        itemSequenceCode: "LINE-A",
      },
    })
  })

  it("rejects a non-positive default label quantity", () => {
    const formData = new FormData()
    formData.set("partNo", "3210A-K1Z-NA01-DL")
    formData.set("partName", "Tube Assy")
    formData.set("unit", "Pcs")
    formData.set("defaultLabelQty", "0")

    expect(parseMasterItemInput(formData)).toEqual({
      error:
        "Default label Qty harus berupa bilangan bulat lebih besar dari 0.",
    })
  })
})

describe("masterItemRpcErrorMessage", () => {
  it("maps a duplicate part number to a safe message", () => {
    expect(masterItemRpcErrorMessage("MASTER_ITEM_PART_NO_EXISTS")).toBe(
      "Part No sudah digunakan.",
    )
  })
})
