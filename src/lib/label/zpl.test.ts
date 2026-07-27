import { describe, expect, it } from "vitest"

import type { FormattedLabelFields } from "@/lib/label/formatter"
import {
  LABEL_LENGTH_DOTS,
  LABEL_WIDTH_DOTS,
  TEMPLATE_VERSION,
  buildLabelZpl,
  escapeZplText,
} from "@/lib/label/zpl"

const sampleFields: FormattedLabelFields = {
  supplierCode: "10015",
  partNo: "3210A-K1Z-NA01-DL",
  qty: "100",
  itemBoxReference: "1-150526-B101",
  deliveryNumber: "DN-2026-0001",
  boxName: "Box Utama",
  deliveryDate: "15-May-2026",
  qrPayload: "10015|3210A-K1Z-NA01-DL|100|1-150526-B101|24-07-2026",
}

describe("escapeZplText", () => {
  it("hex-escapes underscore first, then caret and tilde", () => {
    expect(escapeZplText("A_B^C~D")).toBe("A_5fB_5eC_7eD")
  })

  it("strips ASCII control characters", () => {
    expect(escapeZplText("A\nB\tC\x00D")).toBe("ABCD")
  })

  it("passes plain text through unchanged", () => {
    expect(escapeZplText("3210A-K1Z-NA01-DL")).toBe("3210A-K1Z-NA01-DL")
  })
})

describe("buildLabelZpl", () => {
  const zpl = buildLabelZpl(sampleFields)

  it("exports template version v2 and 203dpi 55x75mm dot dimensions", () => {
    expect(TEMPLATE_VERSION).toBe("v2")
    expect(LABEL_WIDTH_DOTS).toBe(440)
    expect(LABEL_LENGTH_DOTS).toBe(600)
  })

  it("wraps output in ^XA/^XZ with media header for thermal transfer + gap", () => {
    expect(zpl.startsWith("^XA")).toBe(true)
    expect(zpl.endsWith("^XZ")).toBe(true)
    expect(zpl).toContain("^CI28")
    expect(zpl).toContain("^MTT")
    expect(zpl).toContain("^PW440")
    expect(zpl).toContain("^LL600")
    expect(zpl).toContain("^MNY")
  })

  it("renders all seven field values", () => {
    for (const value of Object.values(sampleFields)) {
      expect(zpl).toContain(value)
    }
  })

  it("escapes ZPL control characters in dynamic values", () => {
    const zplEscaped = buildLabelZpl({
      ...sampleFields,
      boxName: "BOX^1~X_2",
    })
    expect(zplEscaped).toContain("BOX_5e1_7eX_5f2")
    expect(zplEscaped).not.toContain("BOX^1")
  })

  it("truncates overlong values instead of overflowing the label", () => {
    const zplLong = buildLabelZpl({
      ...sampleFields,
      boxName: "X".repeat(80),
    })
    expect(zplLong).not.toContain("X".repeat(29))
    expect(zplLong).toContain("X".repeat(25) + "...")
  })

  it("matches the golden sample layout", () => {
    expect(zpl).toMatchSnapshot()
  })

  it("emits a QR block with the payload after the text rows", () => {
    expect(zpl).toContain("^BQN,2,5")
    expect(zpl).toContain(
      "^FDMA,10015|3210A-K1Z-NA01-DL|100|1-150526-B101|24-07-2026^FS",
    )
  })

  it("keeps every element inside the 440x600 dot media area", () => {
    const origins = [...zpl.matchAll(/\^FO(\d+),(\d+)/g)]
    expect(origins.length).toBeGreaterThan(0)
    for (const [, x, y] of origins) {
      expect(Number(x)).toBeLessThan(LABEL_WIDTH_DOTS)
      expect(Number(y)).toBeLessThan(LABEL_LENGTH_DOTS)
    }
  })

  it("escapes ZPL control characters inside the QR payload", () => {
    const zplEscaped = buildLabelZpl({
      ...sampleFields,
      qrPayload: "A^B~C_D",
    })
    expect(zplEscaped).toContain("^FDMA,A_5eB_7eC_5fD^FS")
  })
})
