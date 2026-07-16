import { describe, expect, it } from "vitest"

import {
  parseSupplierInput,
  supplierRpcErrorMessage,
} from "@/features/suppliers/validation"

describe("parseSupplierInput", () => {
  it("normalizes an operator-entered supplier code and name", () => {
    const formData = new FormData()
    formData.set("supplierCode", "  b101 ")
    formData.set("supplierName", "  PT Box Indonesia  ")

    expect(parseSupplierInput(formData)).toEqual({
      data: {
        supplierCode: "B101",
        supplierName: "PT Box Indonesia",
      },
    })
  })

  it("rejects empty supplier names", () => {
    const formData = new FormData()
    formData.set("supplierCode", "B101")
    formData.set("supplierName", "   ")

    expect(parseSupplierInput(formData)).toEqual({
      error: "Nama supplier wajib diisi.",
    })
  })
})

describe("supplierRpcErrorMessage", () => {
  it("returns a safe duplicate-code message", () => {
    expect(supplierRpcErrorMessage("SUPPLIER_CODE_EXISTS")).toBe(
      "Kode supplier sudah digunakan.",
    )
  })
})
