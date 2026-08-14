/**
 * Nomor box dirakit Postgres sebagai 'B' + nomor box + nomor set dua digit
 * (`create_label_box_batch`): B101 adalah box 1 pada set 1, B203 box 2 pada
 * set 3. Formatnya dibaca di sini, bukan ditebak dari urutan daftar: daftar
 * cetak ulang hanya memuat box yang dipilih operator, dan yang pertama di
 * daftar itu bukan berarti yang pertama di batchnya.
 */
const boxNumberPattern = /^B(\d+?)(\d{2})$/

export type ParsedBoxNumber = { boxNo: number; setNo: number }

export function parseBoxNumber(boxNumber: string): ParsedBoxNumber | null {
  const match = boxNumberPattern.exec(boxNumber.trim().toUpperCase())
  if (!match) return null

  return { boxNo: Number(match[1]), setNo: Number(match[2]) }
}

/**
 * Label pertama batch, satu-satunya yang membawa QR: box 1 pada set 1. Nomor
 * yang tidak terbaca formatnya dianggap bukan yang pertama — label tanpa QR
 * masih terbaca mata, sedangkan QR yang tercetak di banyak box membuat satu
 * kiriman punya beberapa label yang mengaku label pertama.
 */
export function isFirstLabelOfBatch(boxNumber: string): boolean {
  const parsed = parseBoxNumber(boxNumber)
  return parsed !== null && parsed.boxNo === 1 && parsed.setNo === 1
}
