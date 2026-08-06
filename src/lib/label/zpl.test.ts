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
  deliveryMonth: "8",
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

  it("exports template version v6 and 203dpi 75x55mm landscape dimensions", () => {
    expect(TEMPLATE_VERSION).toBe("v6")
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
      "No Box",
      "Delivery Date",
      "Lot No",
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

  // Baris kedelapan berakhir 12 dot di atas bingkai; garis pemisah kolom yang
  // berhenti di situ menyisakan potongan menggantung di sudut kiri bawah.
  it("draws the frame and runs the divider down to the frame", () => {
    expect(zpl).toContain("^FO8,8^GB584,424,2^FS")
    expect(zpl).toContain("^FO200,68^GB0,364,2^FS")
  })

  it("runs the right column from the top edge down to the FIFO row", () => {
    expect(zpl).toContain("^FO440,8^GB0,324,2^FS")
  })

  // Garis mendatar yang melintas di tengah blok kolom kanan akan tercetak
  // menembus isinya — QR, angka bulan; di wilayah itu garisnya harus berhenti
  // di kolom kanan, dan hanya garis penutup blok yang melintang penuh.
  it("stops the rules inside the right column and spans full width elsewhere", () => {
    const rules = [...zpl.matchAll(/\^FO8,(\d+)\^GB(\d+),0,2\^FS/g)].map(
      ([, y, width]) => ({ width: Number(width), y: Number(y) }),
    )
    expect(rules.length).toBe(8)

    // Garis kop dan dua garis baris berikutnya mengapit QR; garis di 244
    // jatuh tepat di tengah angka bulan.
    const insideRightColumn = new Set([68, 112, 156, 244])
    for (const rule of rules) {
      expect(rule.width).toBe(insideRightColumn.has(rule.y) ? 432 : 584)
    }
  })

  it("escapes ZPL control characters in dynamic values", () => {
    const zplEscaped = buildLabelZpl({ ...sampleFields, boxNumber: "B^1~X_2" })
    expect(zplEscaped).toContain("B_5e1_7eX_5f2")
    expect(zplEscaped).not.toContain("B^1~")
  })

  // TrueType punya lebar huruf berbeda-beda, jadi pemotongan diserahkan ke
  // printer lewat ^FB. Kolom nilai enam baris pertama lebih sempit karena
  // berbagi tempat dengan kolom kanan, dan lebar blok tiap baris mengikuti itu.
  it("bounds every text field to the width of its own column", () => {
    const blocks = [
      ...zpl.matchAll(/\^FB(\d+),1,0,[CL],0\^FH\^FD([^^]*)\^FS/g),
    ].map(([, width, text]) => ({ text, width: Number(width) }))

    const supplierId = blocks.find((block) => block.text === "10015")
    const lotNo = blocks.find((block) => block.text.startsWith("M-CRT"))
    const boxNumber = blocks.find((block) => block.text === "B101")
    const fieldName = blocks.find((block) => block.text === "Delivery Date")

    expect(supplierId?.width).toBe(212)
    // Lot No 26 karakter di baris terakhir: selebar bingkai, 26 x 14 dot.
    expect(lotNo?.width).toBe(364)
    expect(boxNumber?.width).toBe(212)
    expect(fieldName?.width).toBe(170)
  })

  // Lot No dipindah ke baris terakhir supaya kolomnya selebar bingkai dan
  // hurufnya tidak perlu dikecilkan seperti baris yang berbagi tempat dengan
  // kolom kanan.
  it("prints Lot No in the same face and size as the other values", () => {
    expect(zpl).toContain(
      "^A@N,28,14,E:OUTFITBD.TTF^FB364,1,0,L,0^FH^FDM-CRT-004A-581-300726-B001^FS",
    )
  })

  // Penanda FIFO menempati kolom kanan di bawah QR: angka bulan setinggi dua
  // baris, lalu satu baris teks tetap, keduanya ditengahkan di kolomnya.
  it("prints the delivery month and the FIFO line under the QR", () => {
    expect(zpl).toContain(
      "^FO444,213^A@N,62,34,E:OUTFITBD.TTF^FB144,1,0,C,0^FH^FD8^FS",
    )
    expect(zpl).toContain(
      "^FO444,298^A@N,24,12,E:OUTFITBD.TTF^FB144,1,0,C,0^FH^FDFIFO PT CRT^FS",
    )
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
  // Bold: dalam satu baris keduanya dibaca bersamaan.
  it("draws both columns in the Bold face", () => {
    expect(zpl).toContain(
      "^A@N,32,13,E:OUTFITBD.TTF^FB212,1,0,L,0^FH^FD3210A-K1Z-NA01-DL^FS",
    )
    expect(zpl).toContain(
      "^A@N,28,14,E:OUTFITBD.TTF^FB170,1,0,L,0^FH^FDPart No^FS",
    )
    expect(zpl).not.toContain("E:OUTFITRG.TTF")
    expect(zpl).not.toContain("^A0N,")
  })

  it("escapes ZPL control characters inside the QR payload", () => {
    const zplEscaped = buildLabelZpl({ ...sampleFields, qrPayload: "A^B~C_D" })
    expect(zplEscaped).toContain("^FDMA,A_5eB_7eC_5fD^FS")
  })
})
