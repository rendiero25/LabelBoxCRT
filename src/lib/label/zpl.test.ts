import { describe, expect, it } from "vitest"

import type { FormattedLabelFields } from "@/lib/label/formatter"
import {
  LABEL_LENGTH_DOTS,
  LABEL_WIDTH_DOTS,
  TEMPLATE_VERSION,
  buildLabelZpl,
  escapeZplText,
  qrMagnificationFor,
  qrModulesFor,
} from "@/lib/label/zpl"

const sampleFields: FormattedLabelFields = {
  supplierCode: "10015",
  partNo: "3210A-K1Z-NA01-DL",
  packingQty: "100",
  qtyDelivery: "200",
  masterItemRowNo: "1",
  lotNo: "M-CRT-004A-581-300726-B001",
  boxNumber: "B101",
  deliveryDate: "15-08-2026",
  qrPayload: "10015|3210A-K1Z-NA01-DL|100|1|LOT-A|B101|15-08-2026",
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

// Ukuran QR yang dipatok pernah menembus bingkai: modulnya naik mengikuti
// panjang payload, sedangkan magnifikasi ZPL hanya bilangan bulat.
describe("qrModulesFor", () => {
  it.each([
    [14, 21],
    [62, 33],
    [63, 37],
    [84, 37],
    [85, 41],
    [122, 45],
  ])("gives %i bytes a %i-module symbol", (payloadLength, modules) => {
    expect(qrModulesFor(payloadLength)).toBe(modules)
  })

  it("caps at version 10 instead of dividing by a negative version", () => {
    expect(qrModulesFor(5_000)).toBe(57)
  })
})

describe("qrMagnificationFor", () => {
  it("takes the largest whole multiplier that still fits", () => {
    expect(qrMagnificationFor(37, 148)).toBe(4)
    expect(qrMagnificationFor(37, 147)).toBe(3)
  })

  it("stays inside the 1-10 range ZPL accepts", () => {
    expect(qrMagnificationFor(45, 10)).toBe(1)
    expect(qrMagnificationFor(21, 10_000)).toBe(10)
  })
})

describe("buildLabelZpl", () => {
  const zpl = buildLabelZpl(sampleFields)

  it("exports template version v5 and 203dpi 75x55mm landscape dimensions", () => {
    expect(TEMPLATE_VERSION).toBe("v5")
    expect(LABEL_WIDTH_DOTS).toBe(600)
    expect(LABEL_LENGTH_DOTS).toBe(440)
  })

  it("wraps output in ^XA/^XZ with media header for thermal transfer + gap", () => {
    expect(zpl.startsWith("^XA")).toBe(true)
    expect(zpl.endsWith("^XZ")).toBe(true)
    expect(zpl).toContain("^CI28")
    expect(zpl).toContain("^MTT")
    expect(zpl).toContain("^PW600")
    expect(zpl).toContain("^LL440")
    expect(zpl).toContain("^MNY")
  })

  it("prints the company name as a fixed header", () => {
    expect(zpl).toContain("PT. CRT KABELITA")
  })

  it("prints the eight row labels in the order of the approved layout", () => {
    const labels = [
      "Supplier ID",
      "Part No",
      "Qty/Box",
      "Qty/Delivery",
      "Item List",
      "Lot No",
      "No Box",
      "Delivery Date",
    ]
    const positions = labels.map((label) => zpl.indexOf(`^FD${label}^FS`))

    expect(positions.every((position) => position > 0)).toBe(true)
    expect([...positions].sort((left, right) => left - right)).toEqual(
      positions,
    )
  })

  it("renders every field value", () => {
    for (const value of Object.values(sampleFields)) {
      expect(zpl).toContain(value)
    }
  })

  it("draws the frame and the label/value divider", () => {
    expect(zpl).toContain("^FO8,8^GB584,424,2^FS")
    expect(zpl).toContain("^FO200,68^GB0,352,2^FS")
  })

  it("runs the QR column from the top edge down to the third row", () => {
    expect(zpl).toContain("^FO440,8^GB0,192,2^FS")
  })

  // Garis mendatar yang melintas di belakang QR akan tercetak menembus
  // kodenya; di wilayah QR garisnya harus berhenti di kolom itu.
  it("stops the rules beside the QR and only spans full width below it", () => {
    const rules = [...zpl.matchAll(/\^FO8,(\d+)\^GB(\d+),0,2\^FS/g)].map(
      ([, y, width]) => ({ width: Number(width), y: Number(y) }),
    )
    expect(rules.length).toBe(8)

    for (const rule of rules) {
      expect(rule.width).toBe(rule.y < 200 ? 432 : 584)
    }
  })

  it("escapes ZPL control characters in dynamic values", () => {
    const zplEscaped = buildLabelZpl({ ...sampleFields, boxNumber: "B^1~X_2" })
    expect(zplEscaped).toContain("B_5e1_7eX_5f2")
    expect(zplEscaped).not.toContain("B^1~")
  })

  // TrueType punya lebar huruf berbeda-beda, jadi pemotongan diserahkan ke
  // printer lewat ^FB. Kolom nilai tiga baris pertama lebih sempit karena
  // berbagi tempat dengan QR, dan lebar blok tiap baris harus mengikuti itu.
  it("bounds every text field to the width of its own column", () => {
    const blocks = [
      ...zpl.matchAll(/\^FB(\d+),1,0,L,0\^FH\^FD([^^]*)\^FS/g),
    ].map(([, width, text]) => ({ text, width: Number(width) }))

    const supplierId = blocks.find((block) => block.text === "10015")
    const lotNo = blocks.find((block) => block.text.startsWith("M-CRT"))
    const fieldName = blocks.find((block) => block.text === "Delivery Date")

    expect(supplierId?.width).toBe(212)
    expect(lotNo?.width).toBe(364)
    expect(fieldName?.width).toBe(170)
  })

  it("matches the golden sample layout", () => {
    expect(zpl).toMatchSnapshot()
  })

  it("emits a QR block with the payload", () => {
    expect(zpl).toContain("^BQN,2,4")
    expect(zpl).toContain(
      "^FDMA,10015|3210A-K1Z-NA01-DL|100|1|LOT-A|B101|15-08-2026^FS",
    )
  })

  it("keeps every element inside the 600x440 dot media area", () => {
    const origins = [...zpl.matchAll(/\^FO(\d+),(\d+)/g)]
    expect(origins.length).toBeGreaterThan(0)
    for (const [, x, y] of origins) {
      expect(Number(x)).toBeLessThan(LABEL_WIDTH_DOTS)
      expect(Number(y)).toBeLessThan(LABEL_LENGTH_DOTS)
    }
  })

  it("keeps the QR inside its top-right column", () => {
    const qrOrigin = /\^FO(\d+),(\d+)\^BQN/.exec(zpl)
    expect(qrOrigin).not.toBeNull()

    const [, x, y] = qrOrigin as RegExpExecArray
    expect(Number(x)).toBeGreaterThanOrEqual(440)
    expect(Number(x) + 135).toBeLessThanOrEqual(592)
    expect(Number(y)).toBeGreaterThanOrEqual(8)
    expect(Number(y) + 135).toBeLessThanOrEqual(200)
  })

  // Berat huruf datang dari berkas font yang ditanam, bukan dari mencetak teks
  // dua kali seperti pada font resident. Nama field dan nilainya sama-sama
  // SemiBold: dalam satu baris keduanya dibaca bersamaan.
  it("draws both columns in the SemiBold face", () => {
    expect(zpl).toContain(
      "^A@N,32,13,E:OUTFITSB.TTF^FB212,1,0,L,0^FH^FD3210A-K1Z-NA01-DL^FS",
    )
    expect(zpl).toContain(
      "^A@N,28,14,E:OUTFITSB.TTF^FB170,1,0,L,0^FH^FDPart No^FS",
    )
    expect(zpl).not.toContain("E:OUTFITRG.TTF")
    expect(zpl).not.toContain("^A0N,")
  })

  it("escapes ZPL control characters inside the QR payload", () => {
    const zplEscaped = buildLabelZpl({ ...sampleFields, qrPayload: "A^B~C_D" })
    expect(zplEscaped).toContain("^FDMA,A_5eB_7eC_5fD^FS")
  })
})
