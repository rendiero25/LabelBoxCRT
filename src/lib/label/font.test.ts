import { describe, expect, it } from "vitest"

import {
  LABEL_FONT_BOLD,
  LABEL_FONT_REGULAR,
  buildFontUpload,
  labelFontPath,
} from "@/lib/label/font"

function decode(upload: { data: string }): {
  fontBytes: Uint8Array
  header: string
} {
  const binary = atob(upload.data)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  const separator = binary.indexOf(",,") + 2

  return {
    fontBytes: bytes.subarray(separator),
    header: binary.slice(0, separator),
  }
}

describe("labelFontPath", () => {
  it("points at the printer memory slot the label template references", () => {
    expect(labelFontPath(LABEL_FONT_REGULAR)).toBe("E:OUTFITRG.TTF")
    expect(labelFontPath(LABEL_FONT_BOLD)).toBe("E:OUTFITBD.TTF")
  })
})

describe("buildFontUpload", () => {
  // Format B (biner) dan kode ekstensi T, satu huruf. Unggahan ASCII hex ke
  // flash E: tersimpan dengan nama benar tetapi tidak bisa dipakai pada ZD220
  // yang dipakai di sini: labelnya keluar tanpa satu huruf pun.
  it("declares binary format, the TrueType code and the exact byte count", () => {
    const upload = buildFontUpload("OUTFITRG", new Uint8Array([0, 1, 255]))
    expect(decode(upload).header).toBe("~DYE:OUTFITRG,B,T,3,,")
  })

  it("carries the font bytes verbatim after the header", () => {
    const fontBytes = new Uint8Array([0, 1, 127, 128, 255])
    const upload = buildFontUpload("OUTFITBD", fontBytes)

    expect([...decode(upload).fontBytes]).toEqual([...fontBytes])
  })

  it("survives a font large enough to break argument-splatting", () => {
    const fontBytes = new Uint8Array(50_000).fill(65)
    const upload = buildFontUpload("OUTFITRG", fontBytes)
    const decoded = decode(upload)

    expect(decoded.header).toBe("~DYE:OUTFITRG,B,T,50000,,")
    expect(decoded.fontBytes.length).toBe(50_000)
  })

  it("is marked base64 so QZ restores the bytes instead of sending text", () => {
    expect(buildFontUpload("OUTFITRG", new Uint8Array([1])).flavor).toBe(
      "base64",
    )
  })

  it("refuses an empty font file instead of uploading a broken one", () => {
    expect(() => buildFontUpload("OUTFITRG", new Uint8Array())).toThrow()
  })
})
