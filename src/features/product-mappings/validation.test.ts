import { describe, expect, it } from "vitest"

import {
  parseProductMappingInput,
  productMappingRpcErrorMessage,
} from "@/features/product-mappings/validation"

describe("product mapping validation", () => {
  it("accepts selected Master Item and Product identifiers", () => {
    const formData = new FormData()
    formData.set("masterItemId", " master-item-id ")
    formData.set("productId", " product-id ")

    expect(parseProductMappingInput(formData)).toEqual({
      data: { masterItemId: "master-item-id", productId: "product-id" },
    })
  })

  it("rejects an incomplete Product Mapping selection", () => {
    const formData = new FormData()
    formData.set("masterItemId", "master-item-id")

    expect(parseProductMappingInput(formData)).toEqual({
      error: "Master Item dan produk wajib dipilih.",
    })
  })

  it("maps duplicate mappings to an operator-safe message", () => {
    expect(productMappingRpcErrorMessage("PRODUCT_MAPPING_EXISTS")).toBe(
      "Produk sudah dipetakan ke Master Item ini.",
    )
  })
})
