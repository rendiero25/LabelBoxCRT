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
  supplierName: "PT SUMBER KABEL",
  partNo: "3210A-K1Z-NA01-DL",
  packingQty: "100 pcs",
  qtyDelivery: "200 pcs",
  lotNo: "01-M-CRT-004A-581-300726-B001-B101",
  packingDate: "10-08-2026",
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

  it("exports template version v8 and 203dpi 75x55mm landscape dimensions", () => {
    expect(TEMPLATE_VERSION).toBe("v8")
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

  it("prints the eleven row labels in the order of the approved layout", () => {
    const labels = [
      "CUSTOMER",
      "SUPPLIER ID",
      "PART NO",
      "PART NAME",
      "QTY/BOX",
      "QTY/DELIVERY",
      "PACKING DATE",
      "DELIVERY DATE",
      "LOT NO",
      "OPERATOR PACK",
      "QC Passes",
    ]
    const positions = labels.map((label) => zpl.indexOf(`^FD${label}^FS`))

    expect(positions.every((position) => position > 0)).toBe(true)
    expect([...positions].sort((left, right) => left - right)).toEqual(
      positions,
    )
  })

  // Kolom nilai dicetak huruf besar; nilai mentahnya sendiri dibiarkan apa
  // adanya di FormattedLabelFields supaya QR payload tidak ikut berubah.
  it("renders every field value in upper case", () => {
    for (const value of Object.values(sampleFields)) {
      expect(zpl).toContain(value.toUpperCase())
    }
  })

  // Baris terakhir dipakai cap QC dan tidak berkolom, jadi garis pemisah kolom
  // berhenti di atasnya; garis yang menembusnya membelah ruang capnya jadi dua.
  it("draws the frame and stops the divider above the QC row", () => {
    expect(zpl).toContain("^FO8,8^GB584,424,2^FS")
    expect(zpl).toContain("^FO146,68^GB0,330,2^FS")
  })

  it("runs the right column from the top edge down to the FIFO row", () => {
    expect(zpl).toContain("^FO452,8^GB0,258,2^FS")
  })

  // Garis mendatar yang melintas di tengah blok kolom kanan akan tercetak
  // menembus isinya — QR, angka bulan; di wilayah itu garisnya harus berhenti
  // di kolom kanan, dan hanya garis penutup blok yang melintang penuh.
  it("stops the rules inside the right column and spans full width elsewhere", () => {
    const rules = [...zpl.matchAll(/\^FO8,(\d+)\^GB(\d+),0,2\^FS/g)].map(
      ([, y, width]) => ({ width: Number(width), y: Number(y) }),
    )
    expect(rules.length).toBe(11)

    // Garis kop dan dua garis baris berikutnya mengapit QR; garis di 200
    // jatuh tepat di tengah angka bulan.
    const insideRightColumn = new Set([68, 101, 134, 200])
    for (const rule of rules) {
      expect(rule.width).toBe(insideRightColumn.has(rule.y) ? 444 : 584)
    }
  })

  it("escapes ZPL control characters in dynamic values", () => {
    const zplEscaped = buildLabelZpl({ ...sampleFields, lotNo: "B^1~X_2" })
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
    const lotNo = blocks.find((block) => block.text.startsWith("01-M-CRT"))
    const operatorPack = blocks.find((block) => block.text === "AD | SR | ST")
    const fieldName = blocks.find((block) => block.text === "DELIVERY DATE")
    const qcPasses = blocks.find((block) => block.text === "QC Passes")

    expect(supplierId?.width).toBe(278)
    // Tiga baris terakhir ada di bawah kolom kanan: kolom nilainya selebar
    // bingkai, bukan berhenti di kolom QR seperti enam baris di atasnya.
    expect(lotNo?.width).toBe(418)
    expect(operatorPack?.width).toBe(418)
    expect(fieldName?.width).toBe(116)
    // QC Passes tidak punya kolom nilai; namanya sendiri yang selebar bingkai.
    expect(qcPasses?.width).toBe(556)
  })

  // Lot No seukuran Delivery Date dan nilai lain, dan barisnya selebar bingkai.
  it("prints Lot No at the same size as the other values", () => {
    expect(zpl).toContain(
      "^A@N,23,12,E:OUTFITRG.TTF^FB418,1,0,L,0^FH^FD01-M-CRT-004A-581-300726-B001-B101^FS",
    )
  })

  // Kop nama perusahaan seukuran isinya, bukan judul yang menjulang di atasnya.
  it("prints the company header at the same size as Supplier ID", () => {
    expect(zpl).toContain(
      "^A@N,23,12,E:OUTFITBD.TTF^FB416,1,0,L,0^FH^FDPT. CRT KABELITA^FS",
    )
  })

  // Nama supplier satu-satunya nilai berupa kata: panjangnya tidak bisa
  // diperkirakan saat tata letak dirancang, jadi hurufnya dirapatkan sendiri
  // sampai muat. Nama sepanjang kolomnya dicetak apa adanya.
  it("prints the supplier name at its nominal width when it fits", () => {
    expect(zpl).toContain(
      "^A@N,23,12,E:OUTFITRG.TTF^FB278,1,0,L,0^FH^FDPT SUMBER KABEL^FS",
    )
  })

  it("keeps a 26-character supplier name uncondensed and uncut", () => {
    const zplLong = buildLabelZpl({
      ...sampleFields,
      supplierName: "PT CIPTA MANDIRI WIRASAKTI",
    })
    expect(zplLong).toContain(
      "^A@N,23,12,E:OUTFITRG.TTF^FB278,1,0,L,0^FH^FDPT CIPTA MANDIRI WIRASAKTI^FS",
    )
  })

  it("condenses a supplier name too long for its column", () => {
    const zplLonger = buildLabelZpl({
      ...sampleFields,
      supplierName: "PT SUMBER KABEL NUSANTARA SEJAHTERA ABADI",
    })
    // 41 karakter di blok 278 dot: floor(278 / (41 x 0.75)) = 9.
    expect(zplLonger).toContain(
      "^A@N,23,9,E:OUTFITRG.TTF^FB278,1,0,L,0^FH^FDPT",
    )
  })

  // Ruang di sekitar "QC Passes" sengaja kosong untuk cap QC, jadi baris itu
  // tidak punya kolom nilai sama sekali dan namanya ditengahkan.
  it("centres the QC row and leaves it without a value column", () => {
    expect(zpl).toContain("^FB556,1,0,C,0^FH^FDQC Passes^FS")

    const qcIndex = zpl.indexOf("^FDQC Passes^FS")
    expect(qcIndex).toBeGreaterThan(0)
    expect(zpl.slice(qcIndex)).not.toContain("^FO214,")
  })

  // Penanda FIFO menempati kolom kanan di bawah QR: angka bulan setinggi dua
  // baris, lalu satu baris teks tetap, keduanya ditengahkan di kolomnya.
  it("prints the delivery month and the FIFO line under the QR", () => {
    expect(zpl).toContain(
      "^FO456,174^A@N,51,28,E:OUTFITBD.TTF^FB132,1,0,C,0^FH^FD8^FS",
    )
    expect(zpl).toContain(
      "^FO456,239^A@N,20,10,E:OUTFITBD.TTF^FB132,1,0,C,0^FH^FDFIFO PT CRT^FS",
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
    expect(Number(x)).toBeGreaterThanOrEqual(452)
    expect(Number(x) + 132).toBeLessThanOrEqual(592)
    expect(Number(y)).toBeGreaterThanOrEqual(8)
    expect(Number(y) + 132).toBeLessThanOrEqual(167)
  })

  // Berat huruf datang dari berkas font yang ditanam, bukan dari mencetak teks
  // dua kali seperti pada font resident. Nama field seluruhnya Bold; di kolom
  // nilai hanya yang dicari operator lebih dulu.
  it("draws the field names in Bold and only the sought values with them", () => {
    expect(zpl).toContain(
      "^A@N,12,6,E:OUTFITBD.TTF^FB116,1,0,L,0^FH^FDPART NO^FS",
    )
    expect(zpl).toContain(
      "^A@N,26,11,E:OUTFITBD.TTF^FB278,1,0,L,0^FH^FD3210A-K1Z-NA01-DL^FS",
    )
    expect(zpl).toContain(
      "^A@N,23,12,E:OUTFITBD.TTF^FB278,1,0,L,0^FH^FD100 PCS^FS",
    )
    expect(zpl).toContain(
      "^A@N,23,12,E:OUTFITBD.TTF^FB278,1,0,L,0^FH^FD200 PCS^FS",
    )
    expect(zpl).toContain(
      "^A@N,23,12,E:OUTFITBD.TTF^FB556,1,0,C,0^FH^FDQC Passes^FS",
    )
    expect(zpl).not.toContain("^A0N,")
  })

  // Sisa kolom nilai berat biasa. Kalau semuanya Bold, tidak ada satu pun yang
  // menonjol dan operator membaca seluruh label untuk menemukan satu angka.
  it("draws the remaining values in the Regular face", () => {
    expect(zpl).toContain("E:OUTFITRG.TTF^FB278,1,0,L,0^FH^FD10015^FS")
    // Packing Date, Delivery Date, dan Operator Pack sudah di luar kolom
    // kanan, jadi selebar bingkai (418), bukan berhenti di kolom QR (278).
    expect(zpl).toContain("E:OUTFITRG.TTF^FB418,1,0,L,0^FH^FD15-08-2026^FS")
    expect(zpl).toContain("E:OUTFITRG.TTF^FB418,1,0,L,0^FH^FDAD | SR | ST^FS")
  })

  it("prints the fixed Part Name value regardless of the input fields", () => {
    expect(zpl).toContain(
      "^A@N,23,12,E:OUTFITRG.TTF^FB278,1,0,L,0^FH^FDTUBE^FS",
    )
  })

  it("prints Packing Date above Delivery Date, both spanning the full frame width", () => {
    const packingDateIndex = zpl.indexOf("^FDPACKING DATE^FS")
    const deliveryDateIndex = zpl.indexOf("^FDDELIVERY DATE^FS")
    expect(packingDateIndex).toBeGreaterThan(0)
    expect(deliveryDateIndex).toBeGreaterThan(packingDateIndex)
    expect(zpl).toContain(
      "^A@N,23,12,E:OUTFITRG.TTF^FB418,1,0,L,0^FH^FD10-08-2026^FS",
    )
  })

  it("escapes ZPL control characters inside the QR payload", () => {
    const zplEscaped = buildLabelZpl({ ...sampleFields, qrPayload: "A^B~C_D" })
    expect(zplEscaped).toContain("^FDMA,A_5eB_7eC_5fD^FS")
  })
})
