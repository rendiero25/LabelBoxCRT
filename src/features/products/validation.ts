const productCodePattern = /^[a-z0-9][a-z0-9_-]{1,63}$/

/**
 * Ejaan resmi awalan produk.
 *
 * Awalannya tidak bisa diturunkan dari aturan: data yang ada memuat "VO-B",
 * "CVO-B", dan "VO-Tr" sekaligus, jadi memotong setelah "VO" akan merusak dua
 * yang terakhir — dan "VO-Tr" bahkan berhuruf kecil di belakang. Karena itu
 * daftarnya ditulis, dan yang tersimpan selalu ejaan di sini apa pun cara
 * operator mengetiknya.
 *
 * Menambah awalan baru cukup menambah satu baris di sini.
 */
export const PRODUCT_NAME_PREFIXES = [
  "VO-B",
  "VO-BH",
  "VO-G",
  "VO-Gy",
  "VO-Tr",
  "VO-V",
  "VOHR-B",
  "VOHR-Br",
  "CVO-B",
  "EL067B",
  "EL151-O",
] as const

/** Kunci pencocokan: huruf dan angka saja, huruf besar semua. */
function prefixKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase()
}

/**
 * Awalan terpanjang lebih dulu. "VOBH" harus menang atas "VOB" dan "VOHRBR"
 * atas "VOHRB", kalau tidak nama panjang akan terpotong jadi nama pendek yang
 * kebetulan mengawalinya.
 */
const PREFIXES_LONGEST_FIRST = [...PRODUCT_NAME_PREFIXES].sort(
  (left, right) => prefixKey(right).length - prefixKey(left).length,
)

/** Posisi di teks asli tepat setelah `count` karakter alfanumerik pertama. */
function offsetAfterAlphanumerics(text: string, count: number): number {
  let seen = 0
  for (let index = 0; index < text.length; index += 1) {
    if (/[a-z0-9]/i.test(text[index])) {
      seen += 1
      if (seen === count) return index + 1
    }
  }
  return text.length
}

type ProductDetails = {
  partName: string
  partType: string
  outerDiameter: number
  innerDiameter: number
  length: number
}

type ProductInput = ProductDetails & {
  productCode: string
}

function isUsableDimension(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 1_000_000
}

export function normalizeDimensions(
  outerDiameter: number,
  innerDiameter: number,
  length: number,
): string {
  return `${outerDiameter}x${innerDiameter}x${length}`
}

export function formatProductPreview(
  partName: string,
  outerDiameter: number,
  innerDiameter: number,
  length: number,
): string {
  return `${partName} D${outerDiameter}X${innerDiameter} Pt.L=${length}`
}

/**
 * Jenis part diketik bebas ("tube", "TUBE ASSY") dan disimpan dengan huruf
 * depan tiap kata kapital, supaya "Tube Assy" tidak pernah tersimpan dalam
 * tiga ejaan berbeda dan terhitung sebagai tiga jenis.
 */
export function normalizePartType(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ")
}

export type ParsedProductName = {
  partName: string
  outerDiameter: number
  innerDiameter: number
  length: number
}

/**
 * Nama produk diketik bebas dan dikembalikan dalam bentuk baku.
 *
 * Operator mengetik "vo b 6x7x525" atau "vobh 6x7x 15"; keduanya harus
 * mendarat di "VO-B D6X7 Pt.L=525" dan "VO-BH D6X7 Pt.L=15". Bentuk bakunya
 * sendiri juga harus bisa diketik ulang apa adanya, karena dialog Edit
 * mengisi field ini dengan nama yang sudah baku.
 *
 * Awalan dicocokkan lebih dulu, baru sisanya dibaca sebagai ukuran. Urutan itu
 * penting sejak ada awalan berangka seperti EL067B dan EL151-O: mencari angka
 * di seluruh teks lebih dulu akan membaca "067" sebagai ukuran, dan namanya
 * ditolak karena dianggap punya empat angka.
 */
export function parseProductName(
  raw: string,
): { data: ParsedProductName } | { error: string } {
  const text = raw.trim()
  if (!text) return { error: "Nama produk wajib diisi." }

  const key = prefixKey(text)
  const prefix = PREFIXES_LONGEST_FIRST.find((candidate) =>
    key.startsWith(prefixKey(candidate)),
  )

  if (!prefix) {
    return {
      error: `Awalan nama tidak dikenal. Yang tersedia: ${PRODUCT_NAME_PREFIXES.join(", ")}.`,
    }
  }

  // Bentuk baku menyelipkan "D" sebelum angka pertama ("VO-B D6X7"); huruf itu
  // tinggal di sisa teks dan diabaikan sendirinya karena hanya angka yang
  // diambil dari sana.
  const sizeText = text.slice(
    offsetAfterAlphanumerics(text, prefixKey(prefix).length),
  )
  const numbers = sizeText.match(/\d+(?:\.\d+)?/g) ?? []
  if (numbers.length !== 3) {
    return {
      error:
        "Nama harus memuat tiga angka berurutan: diameter luar, diameter dalam, lalu panjang. Contoh: vo b 6x7x525.",
    }
  }

  const [outerDiameter, innerDiameter, length] = numbers.map(Number)
  if (
    !isUsableDimension(outerDiameter) ||
    !isUsableDimension(innerDiameter) ||
    !isUsableDimension(length)
  ) {
    return { error: "Semua ukuran harus berupa angka lebih besar dari 0." }
  }

  return {
    data: { innerDiameter, length, outerDiameter, partName: prefix },
  }
}

function parseProductDetails(
  formData: FormData,
): { data: ProductDetails } | { error: string } {
  const partType = normalizePartType(String(formData.get("partType") ?? ""))
  if (!partType) return { error: "Part wajib diisi." }
  if (partType.length > 100) return { error: "Part maksimal 100 karakter." }

  const parsedName = parseProductName(String(formData.get("productName") ?? ""))
  if ("error" in parsedName) return parsedName

  return { data: { ...parsedName.data, partType } }
}

export function parseProductCreateInput(
  formData: FormData,
): { data: ProductDetails } | { error: string } {
  return parseProductDetails(formData)
}

export function parseProductInput(
  formData: FormData,
): { data: ProductInput } | { error: string } {
  const productCode = String(formData.get("productCode") ?? "")
    .trim()
    .toLowerCase()
  if (!productCodePattern.test(productCode)) {
    return {
      error:
        "Kode produk harus 2–64 karakter huruf kecil, angka, garis bawah, atau tanda minus.",
    }
  }

  const parsed = parseProductDetails(formData)
  if ("error" in parsed) return parsed

  return { data: { ...parsed.data, productCode } }
}

export function productRpcErrorMessage(message: string): string {
  const messages: Record<string, string> = {
    PRODUCT_ADMIN_REQUIRED: "Aksi ini hanya tersedia untuk admin aktif.",
    PRODUCT_CODE_EXISTS: "Kode produk sudah digunakan.",
    PRODUCT_INPUT_INVALID: "Data produk tidak valid.",
    PRODUCT_NOT_FOUND: "Produk tidak ditemukan.",
    PRODUCT_IN_USE:
      "Produk tidak dapat dihapus karena masih dipakai data lain.",
  }

  return messages[message] ?? "Aksi produk gagal. Coba lagi atau hubungi admin."
}
