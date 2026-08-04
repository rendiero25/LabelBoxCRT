/**
 * Nama layer dibuat otomatis dengan pola "Box 1 - Layer 2", padahal nomor
 * layernya sudah ditampilkan terpisah di UI. Menampilkan keduanya apa adanya
 * menghasilkan "Layer 2 · Box 1 - Layer 2", yang membaca nomor yang sama dua
 * kali. Sufiks itu dibuang di lapisan tampilan saja; datanya tidak diubah,
 * karena nama lengkap tetap dipakai tempat lain yang tidak punya konteks box.
 */
const LAYER_SUFFIX_PATTERN = /\s*[-–—·]?\s*layer\s*\d+\s*$/i

export function shortenLayerName(layerName: string): string {
  const trimmed = layerName.trim()
  const shortened = trimmed.replace(LAYER_SUFFIX_PATTERN, "").trim()

  // Nama yang isinya hanya "Layer 2" tidak menyisakan apa pun setelah sufiks
  // dibuang; kembalikan aslinya daripada memberi label kosong.
  return shortened || trimmed
}
