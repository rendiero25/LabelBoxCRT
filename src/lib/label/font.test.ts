import { describe, expect, it } from "vitest"

import {
  LABEL_FONT_BOLD,
  LABEL_FONT_REGULAR,
  buildFontUploadZpl,
  labelFontPath,
} from "@/lib/label/font"

describe("labelFontPath", () => {
  it("points at the printer memory slot the label template references", () => {
    expect(labelFontPath(LABEL_FONT_REGULAR)).toBe("E:OUTFITRG.TTF")
    expect(labelFontPath(LABEL_FONT_BOLD)).toBe("E:OUTFITSB.TTF")
  })
})

describe("buildFontUploadZpl", () => {
  it("declares the device, format, extension and exact byte count", () => {
    const zpl = buildFontUploadZpl("OUTFITRG", new Uint8Array([0, 1, 255]))
    expect(zpl).toBe("~DYE:OUTFITRG,A,TTF,3,,0001FF")
  })

  // Panjang yang dideklarasikan harus byte, bukan karakter hex. Salah di sini
  // membuat printer menunggu data yang tidak pernah datang dan menggantung
  // antrean cetak berikutnya.
  it("counts bytes, not the hex characters that carry them", () => {
    const zpl = buildFontUploadZpl("OUTFITRG", new Uint8Array(48))
    expect(zpl).toContain(",TTF,48,,")
    expect(zpl.slice(zpl.indexOf(",,") + 2).length).toBe(96)
  })

  it("pads every byte to two hex digits", () => {
    const zpl = buildFontUploadZpl("OUTFITRG", new Uint8Array([10, 5]))
    expect(zpl.endsWith(",0A05")).toBe(true)
  })

  it("refuses an empty font file instead of uploading a broken one", () => {
    expect(() => buildFontUploadZpl("OUTFITRG", new Uint8Array())).toThrow()
  })
})
