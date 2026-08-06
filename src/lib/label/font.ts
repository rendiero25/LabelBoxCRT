/**
 * Penanaman font TrueType ke memori printer.
 *
 * Font resident ZPL (^A0) bentuknya kaku dan tidak sama dengan tampilan
 * aplikasi. Zebra bisa memakai TrueType asal berkasnya lebih dulu disimpan di
 * memori printer lewat ~DY, lalu dirujuk ^A@ memakai jalur perangkatnya.
 *
 * Data dikirim biner, bukan ASCII hex. Keduanya sah menurut dokumentasi ZPL,
 * tetapi pada ZD220 yang dipakai di sini objek hasil unggahan hex ke flash E:
 * tersimpan dengan nama yang benar namun tidak dapat dipakai: label yang
 * merujuknya keluar tanpa satu huruf pun, tanpa pesan kesalahan. Unggahan biner
 * ke lokasi yang sama terbukti tercetak, dan payload-nya juga sepertiga lebih
 * kecil.
 */

export const LABEL_FONT_DEVICE = "E:"

export const LABEL_FONT_REGULAR = "OUTFITRG"
/**
 * Bold, bukan SemiBold. Label dibaca di gudang: cetakan termal pada media buram
 * menipiskan garis huruf, dan pada ukuran 24-28 dot SemiBold sudah mendekati
 * berat biasa. Bold menahan bentuknya setelah dicetak.
 */
export const LABEL_FONT_BOLD = "OUTFITBD"

/** Kode ekstensi ~DY, satu huruf: T untuk TrueType, bukan "TTF". */
const TRUETYPE_EXTENSION_CODE = "T"

/**
 * Entri cetak QZ. Perintah ~DY membawa byte font apa adanya, jadi seluruh
 * perintah dikirim sebagai base64 dan QZ yang memulihkannya menjadi byte
 * sebelum diteruskan ke printer.
 */
export type LabelFontUpload = {
  data: string
  flavor: "base64"
}

export function labelFontPath(fontName: string): string {
  return `${LABEL_FONT_DEVICE}${fontName}.TTF`
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ""
  // Dipecah supaya String.fromCharCode tidak menerima puluhan ribu argumen
  // sekaligus, yang melebihi batas argumen di sebagian mesin JS.
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192))
  }
  return btoa(binary)
}

/**
 * Perintah ~DY untuk satu berkas font. Printer menyimpannya sampai memorinya
 * dibersihkan atau printer di-reset pabrik, jadi pengunggahan ulang bersifat
 * idempoten: berkas dengan nama sama akan ditimpa.
 */
export function buildFontUpload(
  fontName: string,
  fontBytes: Uint8Array,
): LabelFontUpload {
  if (fontBytes.length === 0) {
    throw new Error(`buildFontUpload: font "${fontName}" is empty`)
  }

  const header = `~DY${LABEL_FONT_DEVICE}${fontName},B,${TRUETYPE_EXTENSION_CODE},${fontBytes.length},,`
  const headerBytes = new TextEncoder().encode(header)
  const command = new Uint8Array(headerBytes.length + fontBytes.length)
  command.set(headerBytes, 0)
  command.set(fontBytes, headerBytes.length)

  return { data: toBase64(command), flavor: "base64" }
}
