/**
 * Penanaman font TrueType ke memori printer.
 *
 * Font resident ZPL (^A0) bentuknya kaku dan tidak sama dengan tampilan
 * aplikasi. Zebra bisa memakai TrueType asal berkasnya lebih dulu disimpan di
 * memori printer lewat ~DY, lalu dirujuk ^A@ memakai jalur perangkatnya.
 *
 * Format ASCII hex (parameter `A`) dipilih daripada biner: payload jadi dua
 * kali lipat, tetapi seluruh perintah tetap teks murni sehingga aman melewati
 * WebSocket QZ, log, dan pemeriksaan payload tanpa perlu penanganan khusus.
 */

export const LABEL_FONT_DEVICE = "E:"

export const LABEL_FONT_REGULAR = "OUTFITRG"
export const LABEL_FONT_BOLD = "OUTFITSB"

export function labelFontPath(fontName: string): string {
  return `${LABEL_FONT_DEVICE}${fontName}.TTF`
}

/**
 * Perintah ~DY untuk satu berkas font. Printer menyimpannya sampai memorinya
 * dibersihkan atau printer di-reset pabrik, jadi pengunggahan ulang bersifat
 * idempoten: berkas dengan nama sama akan ditimpa.
 */
export function buildFontUploadZpl(
  fontName: string,
  fontBytes: Uint8Array,
): string {
  if (fontBytes.length === 0) {
    throw new Error(`buildFontUploadZpl: font "${fontName}" is empty`)
  }

  let hex = ""
  for (const byte of fontBytes) {
    hex += byte.toString(16).padStart(2, "0").toUpperCase()
  }

  return `~DY${LABEL_FONT_DEVICE}${fontName},A,TTF,${fontBytes.length},,${hex}`
}
