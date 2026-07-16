import { describe, expect, it } from "vitest"

import {
  formatProductPreview,
  normalizeDimensions,
  parseProductCreateInput,
  parseProductInput,
  productRpcErrorMessage,
} from "@/features/products/validation"

describe("product validation", () => {
  it("normalizes product code and dimensions for the database preview", () => {
    const formData = new FormData()
    formData.set("productCode", " TUBE-0001 ")
    formData.set("partName", " Tube ")
    formData.set("outerDiameter", "6.30")
    formData.set("innerDiameter", "5.5")
    formData.set("length", "205.00")

    expect(parseProductInput(formData)).toEqual({
      data: {
        productCode: "tube-0001",
        partName: "Tube",
        outerDiameter: 6.3,
        innerDiameter: 5.5,
        length: 205,
      },
    })
    expect(normalizeDimensions(6.3, 5.5, 205)).toBe("6.3x5.5x205")
  })

  it("rejects zero dimensions", () => {
    const formData = new FormData()
    formData.set("productCode", "tube-0001")
    formData.set("partName", "Tube")
    formData.set("outerDiameter", "0")
    formData.set("innerDiameter", "5.5")
    formData.set("length", "205")

    expect(parseProductInput(formData)).toEqual({
      error: "Semua dimensi harus berupa angka lebih besar dari 0.",
    })
  })

  it("creates a product without a user-supplied code and formats its label preview", () => {
    const formData = new FormData()
    formData.set("partName", " VO-B ")
    formData.set("outerDiameter", "6")
    formData.set("innerDiameter", "7")
    formData.set("length", "525")

    expect(parseProductCreateInput(formData)).toEqual({
      data: {
        partName: "VO-B",
        outerDiameter: 6,
        innerDiameter: 7,
        length: 525,
      },
    })
    expect(formatProductPreview("VO-B", 6, 7, 525)).toBe("VO-B D6X7 Pt.L=525")
  })

  it("maps a duplicate product code to a safe message", () => {
    expect(productRpcErrorMessage("PRODUCT_CODE_EXISTS")).toBe(
      "Kode produk sudah digunakan.",
    )
  })
})
