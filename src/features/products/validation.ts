const productCodePattern = /^[a-z0-9][a-z0-9_-]{1,63}$/
const decimalPattern = /^\d+(?:\.\d+)?$/

type ProductDetails = {
  partName: string
  outerDiameter: number
  innerDiameter: number
  length: number
}

type ProductInput = ProductDetails & {
  productCode: string
}

function parsePositiveDimension(
  value: FormDataEntryValue | null,
): number | null {
  const normalized = String(value ?? "").trim()
  if (!decimalPattern.test(normalized)) return null

  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1_000_000
    ? parsed
    : null
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

function parseProductDetails(
  formData: FormData,
): { data: ProductDetails } | { error: string } {
  const partName = String(formData.get("partName") ?? "").trim()
  const outerDiameter = parsePositiveDimension(formData.get("outerDiameter"))
  const innerDiameter = parsePositiveDimension(formData.get("innerDiameter"))
  const length = parsePositiveDimension(formData.get("length"))

  if (!partName) return { error: "Nama part wajib diisi." }
  if (partName.length > 200) {
    return { error: "Nama part maksimal 200 karakter." }
  }
  if (outerDiameter === null || innerDiameter === null || length === null) {
    return { error: "Semua dimensi harus berupa angka lebih besar dari 0." }
  }

  return {
    data: { partName, outerDiameter, innerDiameter, length },
  }
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
    PRODUCT_IN_USE: "Produk tidak dapat dihapus karena masih dipakai data lain.",
  }

  return messages[message] ?? "Aksi produk gagal. Coba lagi atau hubungi admin."
}
