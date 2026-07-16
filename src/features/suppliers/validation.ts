const supplierCodePattern = /^[A-Z0-9_-]{2,64}$/

type SupplierInput = {
  supplierCode: string
  supplierName: string
}

export function parseSupplierInput(
  formData: FormData,
): { data: SupplierInput } | { error: string } {
  const supplierCode = String(formData.get("supplierCode") ?? "")
    .trim()
    .toUpperCase()
  const supplierName = String(formData.get("supplierName") ?? "").trim()

  if (!supplierCodePattern.test(supplierCode)) {
    return {
      error:
        "Kode supplier harus 2–64 karakter A–Z, angka, garis bawah, atau tanda minus.",
    }
  }

  if (!supplierName) return { error: "Nama supplier wajib diisi." }
  if (supplierName.length > 200) {
    return { error: "Nama supplier maksimal 200 karakter." }
  }

  return { data: { supplierCode, supplierName } }
}

export function supplierRpcErrorMessage(message: string): string {
  const messages: Record<string, string> = {
    SUPPLIER_ADMIN_REQUIRED: "Aksi ini hanya tersedia untuk admin aktif.",
    SUPPLIER_CODE_EXISTS: "Kode supplier sudah digunakan.",
    SUPPLIER_INPUT_INVALID: "Data supplier tidak valid.",
    SUPPLIER_NOT_FOUND: "Supplier tidak ditemukan.",
  }

  return (
    messages[message] ?? "Aksi supplier gagal. Coba lagi atau hubungi admin."
  )
}
