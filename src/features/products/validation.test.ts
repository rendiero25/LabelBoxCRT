import { describe, expect, it } from "vitest"

import {
  PRODUCT_NAME_PREFIXES,
  formatProductPreview,
  normalizeDimensions,
  normalizePartType,
  parseProductCreateInput,
  parseProductInput,
  parseProductName,
  productRpcErrorMessage,
} from "@/features/products/validation"

function nameOf(raw: string): string {
  const parsed = parseProductName(raw)
  if ("error" in parsed) throw new Error(parsed.error)
  return formatProductPreview(
    parsed.data.partName,
    parsed.data.outerDiameter,
    parsed.data.innerDiameter,
    parsed.data.length,
  )
}

describe("parseProductName", () => {
  // Bentuk yang benar-benar diketik operator, bukan bentuk bakunya.
  it.each([
    ["vo b 6x7x525", "VO-B D6X7 Pt.L=525"],
    ["vobh 6x7x 15", "VO-BH D6X7 Pt.L=15"],
    ["VOB 6 x 7 x 100", "VO-B D6X7 Pt.L=100"],
    ["cvo-b 10x11x220", "CVO-B D10X11 Pt.L=220"],
    ["vo tr 6x7x315", "VO-Tr D6X7 Pt.L=315"],
  ])("turns %s into %s", (typed, expected) => {
    expect(nameOf(typed)).toBe(expected)
  })

  // Dialog Edit mengisi field ini dengan nama yang sudah baku, jadi bentuk
  // baku harus bisa masuk lagi tanpa berubah — termasuk huruf D sebelum angka.
  it.each([
    "VO-B D6X7 Pt.L=525",
    "CVO-B D10X11 Pt.L=220",
    "VO-Tr D6X7 Pt.L=315",
  ])("leaves the canonical form %s untouched", (canonical) => {
    expect(nameOf(canonical)).toBe(canonical)
  })

  it("keeps decimal sizes as they were typed", () => {
    expect(nameOf("vo b 6.3x5.5x205")).toBe("VO-B D6.3X5.5 Pt.L=205")
  })

  it("refuses a prefix that is not on the list", () => {
    const parsed = parseProductName("voxy 6x7x100")
    expect(parsed).toEqual({
      error: `Awalan nama tidak dikenal. Yang tersedia: ${PRODUCT_NAME_PREFIXES.join(", ")}.`,
    })
  })

  it.each([
    ["vo b 6x7", "dua angka"],
    ["vo b 6x7x525x9", "empat angka"],
    ["vo b", "tanpa angka"],
  ])("refuses %s (%s)", (typed) => {
    const parsed = parseProductName(typed)
    expect("error" in parsed && parsed.error).toContain("tiga angka")
  })

  it("refuses a zero dimension", () => {
    expect(parseProductName("vo b 0x7x525")).toEqual({
      error: "Semua ukuran harus berupa angka lebih besar dari 0.",
    })
  })

  it("refuses an empty name", () => {
    expect(parseProductName("   ")).toEqual({
      error: "Nama produk wajib diisi.",
    })
  })
})

describe("normalizePartType", () => {
  it.each([
    ["tube", "Tube"],
    ["TUBE ASSY", "Tube Assy"],
    ["  tube   assy  ", "Tube Assy"],
    ["Tube Assy", "Tube Assy"],
  ])("stores %s as %s", (typed, expected) => {
    expect(normalizePartType(typed)).toBe(expected)
  })
})

describe("product form parsing", () => {
  it("reads the two fields a product is created from", () => {
    const formData = new FormData()
    formData.set("partType", " tube assy ")
    formData.set("productName", "vo b 6x7x525")

    expect(parseProductCreateInput(formData)).toEqual({
      data: {
        innerDiameter: 7,
        length: 525,
        outerDiameter: 6,
        partName: "VO-B",
        partType: "Tube Assy",
      },
    })
    expect(normalizeDimensions(6, 7, 525)).toBe("6x7x525")
  })

  // Kode produk tidak lagi punya field di form; dialog Edit mengirimkannya
  // sebagai input tersembunyi supaya kodenya tetap sama seperti semula.
  it("keeps the hidden product code on update", () => {
    const formData = new FormData()
    formData.set("productCode", " PRD-000001 ")
    formData.set("partType", "tube")
    formData.set("productName", "cvo-b 10x11x220")

    expect(parseProductInput(formData)).toEqual({
      data: {
        innerDiameter: 11,
        length: 220,
        outerDiameter: 10,
        partName: "CVO-B",
        partType: "Tube",
        productCode: "prd-000001",
      },
    })
  })

  it("refuses an empty part", () => {
    const formData = new FormData()
    formData.set("partType", "   ")
    formData.set("productName", "vo b 6x7x525")

    expect(parseProductCreateInput(formData)).toEqual({
      error: "Part wajib diisi.",
    })
  })

  it("maps a duplicate product code to a safe message", () => {
    expect(productRpcErrorMessage("PRODUCT_CODE_EXISTS")).toBe(
      "Kode produk sudah digunakan.",
    )
  })
})
