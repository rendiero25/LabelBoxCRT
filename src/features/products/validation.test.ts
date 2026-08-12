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
    ["vo gy 8x9x200", "VO-Gy D8X9 Pt.L=200"],
    ["vo v 6x7x80", "VO-V D6X7 Pt.L=80"],
    ["vo g 12x13x55", "VO-G D12X13 Pt.L=55"],
    ["vohr b 10x11x170", "VOHR-B D10X11 Pt.L=170"],
    ["vohr br 6x7x135", "VOHR-Br D6X7 Pt.L=135"],
  ])("turns %s into %s", (typed, expected) => {
    expect(nameOf(typed)).toBe(expected)
  })

  /**
   * Dua awalan memuat angka di dalam namanya sendiri. Kalau angka dicari di
   * seluruh teks lebih dulu, "067" terbaca sebagai ukuran dan namanya ditolak
   * karena dianggap berangka empat.
   */
  it.each([
    ["el067b 6x7x525", "EL067B D6X7 Pt.L=525"],
    ["EL067B 10x11x220", "EL067B D10X11 Pt.L=220"],
    ["el151 o 6x7x315", "EL151-O D6X7 Pt.L=315"],
    ["el151-o 8x9x200", "EL151-O D8X9 Pt.L=200"],
  ])("reads %s without mistaking its digits for a size", (typed, expected) => {
    expect(nameOf(typed)).toBe(expected)
  })

  /**
   * Awalan yang mengawali awalan lain: yang terpanjang harus menang, kalau
   * tidak "vohr br" mendarat di VOHR-B dan produknya tertukar diam-diam.
   */
  it.each([
    ["vobh 6x7x15", "VO-BH"],
    ["vob 6x7x15", "VO-B"],
    ["vogy 6x7x15", "VO-Gy"],
    ["vog 6x7x15", "VO-G"],
    ["vohrbr 6x7x15", "VOHR-Br"],
    ["vohrb 6x7x15", "VOHR-B"],
  ])("matches %s to the longest prefix %s", (typed, expected) => {
    const parsed = parseProductName(typed)
    expect("error" in parsed ? parsed.error : parsed.data.partName).toBe(
      expected,
    )
  })

  // Dialog Edit mengisi field ini dengan nama yang sudah baku, jadi bentuk
  // baku harus bisa masuk lagi tanpa berubah — termasuk huruf D sebelum angka.
  it.each([
    "VO-B D6X7 Pt.L=525",
    "CVO-B D10X11 Pt.L=220",
    "VO-Tr D6X7 Pt.L=315",
    "EL067B D6X7 Pt.L=525",
    "EL151-O D8X9 Pt.L=200",
    "VOHR-Br D6X7 Pt.L=135",
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
