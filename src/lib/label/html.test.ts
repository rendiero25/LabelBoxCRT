import { describe, expect, it } from "vitest"

import type { FormattedLabelFields } from "@/lib/label/formatter"
import {
  LABELS_PER_SHEET,
  SHEET_HEIGHT_MM,
  SHEET_WIDTH_MM,
  buildLabelHtml,
  buildLabelSheetHtml,
  buildLabelSheetsHtml,
  escapeHtml,
  fitFontHeight,
  paginateLabels,
} from "@/lib/label/html"

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

const qrDataUrl = "data:image/png;base64,QQ=="

describe("escapeHtml", () => {
  it("escapes the characters that would break out of markup", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
    )
  })

  it("escapes the ampersand first so escapes are not double-escaped", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;")
  })
})

// ^FB pada jalur ZPL memotong diam-diam, dan potongannya baru ketahuan setelah
// label tertempel di box. Di HTML ukurannya dihitung dulu supaya nilai panjang
// mengecil, bukan hilang separuh.
describe("fitFontHeight", () => {
  it("keeps the nominal height when the text already fits", () => {
    expect(fitFontHeight("100", 212, 28)).toBe(28)
  })

  it("shrinks text that would overflow its column", () => {
    const fitted = fitFontHeight("M-CRT-004A-581-300726-B001", 212, 24)
    expect(fitted).toBeLessThan(24)
    expect(fitted * 26 * 0.72).toBeCloseTo(212, 5)
  })

  it("never returns a size whose estimated width exceeds the column", () => {
    for (const text of [
      "3210A-K1Z-NA01-DL",
      "M-CRT-004A-581-300726-B001",
      "Delivery Date",
      "FIFO PT CRT",
    ]) {
      const fitted = fitFontHeight(text, 212, 32)
      expect(text.length * 0.72 * fitted).toBeLessThanOrEqual(212 + 1e-9)
    }
  })

  it("leaves an empty value at its nominal height instead of dividing by zero", () => {
    expect(fitFontHeight("", 212, 28)).toBe(28)
  })
})

describe("buildLabelHtml", () => {
  const html = buildLabelHtml(sampleFields, qrDataUrl)

  it("sizes the label to the same 75x55mm as the ZPL template", () => {
    expect(html).toContain("width:75mm;height:55mm")
  })

  it("prints the company name and all eleven field names", () => {
    for (const name of [
      "PT. CRT KABELITA",
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
    ]) {
      expect(html).toContain(`>${name}</div>`)
    }
  })

  // Kolom nilai dicetak huruf besar. Nama supplier dan Lot No dibungkus span
  // yang merapatkan hurufnya, jadi keduanya diperiksa tanpa penutup </div>.
  it("renders every field value in upper case", () => {
    for (const value of [
      sampleFields.supplierCode,
      sampleFields.packingQty,
      sampleFields.qtyDelivery,
      sampleFields.packingDate,
      sampleFields.deliveryDate,
      "AD | SR | ST",
    ]) {
      expect(html).toContain(`>${value.toUpperCase()}</div>`)
    }

    for (const value of [
      sampleFields.supplierName,
      sampleFields.partNo,
      sampleFields.lotNo,
    ]) {
      expect(html).toContain(`>${value.toUpperCase()}<`)
    }
  })

  it("prints the fixed Part Name value regardless of the input fields", () => {
    expect(html).toContain(">TUBE</div>")
  })

  // Baris terakhir dipakai cap QC dan tidak berkolom; garis pemisah kolom yang
  // menembusnya membelah ruang capnya jadi dua.
  it("stops the column divider above the QC row", () => {
    expect(html).toContain("left:18.25mm;top:8.5mm;width:0.25mm;height:41.25mm")
  })

  // Nama baris QC Passes membentang selebar bingkai: 592 - 22 - 14 = 556 dot,
  // dan barisnya kini yang kesebelas, bukan kesembilan.
  // dan ditengahkan di dalamnya.
  it("centres the QC row across the frame with no value column", () => {
    expect(html).toContain("left:2.75mm;top:49.75mm;width:69.5mm")
    expect(html).toContain("justify-content:center;font-size:2.875mm")
    expect(html.slice(html.indexOf(">QC Passes</div>"))).not.toContain(
      "left:26.75mm",
    )
  })

  it("prints the FIFO markers under the QR", () => {
    expect(html).toContain(">8</div>")
    expect(html).toContain(">FIFO PT CRT</div>")
  })

  it("embeds the QR as an image instead of letting the printer draw it", () => {
    expect(html).toContain(`src="${qrDataUrl}"`)
  })

  // 136 dot lebar kolom QR, dikecilkan 5% jadi 129.2 dot = 16.15mm, lalu
  // ditengahkan lagi di kolomnya.
  it("prints the QR 5% smaller than its column", () => {
    expect(html).toContain("width:16.15mm;height:16.15mm")
  })

  // Nilai label datang dari data pengguna. Tanpa escape, part no yang memuat
  // "<" akan menutup div-nya dan merusak sisa lembarnya.
  it("escapes markup characters inside field values", () => {
    const escaped = buildLabelHtml(
      { ...sampleFields, partNo: '<script>"x"' },
      qrDataUrl,
    )
    expect(escaped).toContain("&lt;SCRIPT&gt;&quot;X&quot;")
    expect(escaped).not.toContain("<script>")
    expect(escaped).not.toContain("<SCRIPT>")
  })

  // Kolom nilai enam baris pertama berbagi tempat dengan kolom kanan, sama
  // seperti di ZPL; kalau teksnya membungkus, tinggi barisnya jadi meleset.
  it("clips overlong values to their column instead of wrapping", () => {
    expect(html).toContain("white-space:nowrap;overflow:hidden")
  })
})

describe("paginateLabels", () => {
  it("fills whole sheets and leaves the last one short", () => {
    const labels = Array.from({ length: 23 }, (_, index) => index)
    const sheets = paginateLabels(labels)

    expect(sheets.map((sheet) => sheet.length)).toEqual([10, 10, 3])
    expect(sheets.flat()).toEqual(labels)
  })

  it("returns no sheets for an empty run", () => {
    expect(paginateLabels([])).toEqual([])
  })

  it("puts ten labels on a sheet", () => {
    expect(LABELS_PER_SHEET).toBe(10)
  })
})

describe("buildLabelSheetHtml", () => {
  const sheet = buildLabelSheetHtml(["<i>A</i>", "<i>B</i>", "<i>C</i>"])

  it("sizes the page to A4 portrait", () => {
    expect(sheet).toContain(
      `width:${SHEET_WIDTH_MM}mm;height:${SHEET_HEIGHT_MM}mm`,
    )
  })

  // Kisi 2x5 label 75x55mm di A4: sisa kertas kiri-kanan 30mm, atas-bawah 11mm.
  it("centres the 2x5 grid on the sheet", () => {
    expect(sheet).toContain("left:30mm;top:11mm")
    expect(sheet).toContain("left:105mm;top:11mm")
    expect(sheet).toContain("left:30mm;top:66mm")
  })

  it("keeps the labels in the order they were given", () => {
    expect(sheet.indexOf("<i>A</i>")).toBeLessThan(sheet.indexOf("<i>B</i>"))
    expect(sheet.indexOf("<i>B</i>")).toBeLessThan(sheet.indexOf("<i>C</i>"))
  })

  // Outfit yang ditanam lewat @font-face tercetak dengan glyph salah di perender
  // QZ — huruf kecil keluar sebagai huruf beraksen. Lembarnya karena itu tidak
  // boleh menanam font sama sekali.
  it("embeds no font file at all", () => {
    expect(sheet).not.toContain("@font-face")
    expect(sheet).not.toContain("data:font")
  })
})

describe("buildLabelSheetsHtml", () => {
  it("emits one document per sheet", () => {
    const labels = Array.from({ length: 12 }, (_, index) => `<i>${index}</i>`)
    const sheets = buildLabelSheetsHtml(labels)

    expect(sheets.length).toBe(2)
    for (const sheet of sheets) {
      expect(sheet.startsWith("<!doctype html>")).toBe(true)
      expect(sheet.endsWith("</html>")).toBe(true)
    }
    expect(sheets[1]).toContain("<i>10</i>")
    expect(sheets[1]).toContain("<i>11</i>")
    expect(sheets[1]).not.toContain("<i>9</i>")
  })

  it("sends nothing when there is nothing to print", () => {
    expect(buildLabelSheetsHtml([])).toEqual([])
  })
})
