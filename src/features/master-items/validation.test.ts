import { describe, expect, it } from "vitest"

import {
  masterItemRpcErrorMessage,
  parseMasterItemInput,
} from "@/features/master-items/validation"

function validFormData(): FormData {
  const formData = new FormData()
  formData.set("partNo", "3210a-k1z-na01-dl")
  formData.set("partName", " Tube Assy ")
  formData.set("unit", "PCS")
  formData.set("defaultLabelQty", "100")
  return formData
}

describe("parseMasterItemInput", () => {
  it("normalizes part no, part name, unit, and qty", () => {
    expect(parseMasterItemInput(validFormData())).toEqual({
      data: {
        partNo: "3210A-K1Z-NA01-DL",
        partName: "Tube Assy",
        unit: "Pcs",
        defaultLabelQty: 100,
        supplierId: null,
      },
    })
  })

  it("treats a missing or placeholder supplier as no supplier", () => {
    const blank = parseMasterItemInput(validFormData())
    expect("data" in blank && blank.data.supplierId).toBe(null)

    const placeholder = validFormData()
    placeholder.set("supplierId", "none")
    const parsedPlaceholder = parseMasterItemInput(placeholder)
    expect(
      "data" in parsedPlaceholder && parsedPlaceholder.data.supplierId,
    ).toBe(null)
  })

  it("keeps a real supplier id", () => {
    const formData = validFormData()
    formData.set("supplierId", "0d5e6b1a-8f2c-4a3d-9e7b-1c2d3e4f5a6b")
    const parsed = parseMasterItemInput(formData)
    expect("data" in parsed && parsed.data.supplierId).toBe(
      "0d5e6b1a-8f2c-4a3d-9e7b-1c2d3e4f5a6b",
    )
  })

  it("no longer reads or requires itemSequenceCode", () => {
    const formData = validFormData()
    formData.set("itemSequenceCode", "LINE-A")
    const result = parseMasterItemInput(formData)
    expect("data" in result && "itemSequenceCode" in result.data).toBe(false)
  })

  it("rejects a zero packing qty with the Packing Qty wording", () => {
    const formData = validFormData()
    formData.set("defaultLabelQty", "0")

    expect(parseMasterItemInput(formData)).toEqual({
      error: "Packing Qty harus berupa bilangan bulat lebih besar dari 0.",
    })
  })

  it("rejects an invalid part no", () => {
    const formData = validFormData()
    formData.set("partNo", "!!")

    const result = parseMasterItemInput(formData)
    expect("error" in result && result.error).toMatch(/Part No/)
  })

  // Nomor part dari pelanggan memang ditulis berspasi; spasi berderet
  // dirapatkan supaya satu part tidak tercatat dua kali dengan ejaan berbeda.
  it("accepts a part no with spaces and collapses repeated ones", () => {
    const formData = validFormData()
    formData.set("partNo", "  vo   b   6x7  ")

    const result = parseMasterItemInput(formData)
    expect("data" in result && result.data.partNo).toBe("VO B 6X7")
  })

  it("still rejects a part no made of nothing but spaces", () => {
    const formData = validFormData()
    formData.set("partNo", "   ")

    const result = parseMasterItemInput(formData)
    expect("error" in result && result.error).toMatch(/Part No/)
  })
})

describe("masterItemRpcErrorMessage", () => {
  it.each([
    ["MASTER_ITEM_CODE_EXISTS", "Kode item sudah digunakan."],
    ["MASTER_ITEM_PART_NO_EXISTS", "Part No sudah digunakan."],
  ])("maps %s to a safe Indonesian message", (code, message) => {
    expect(masterItemRpcErrorMessage(code)).toBe(message)
  })

  it("hides unexpected RPC errors", () => {
    expect(masterItemRpcErrorMessage("database detail")).toBe(
      "Aksi Master Item gagal. Coba lagi atau hubungi admin.",
    )
  })
})
