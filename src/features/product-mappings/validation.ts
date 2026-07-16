type ProductMappingInput = {
  masterItemId: string
  productId: string
}

export function parseProductMappingInput(
  formData: FormData,
): { data: ProductMappingInput } | { error: string } {
  const masterItemId = String(formData.get("masterItemId") ?? "").trim()
  const productId = String(formData.get("productId") ?? "").trim()

  if (!masterItemId || !productId) {
    return { error: "Master Item dan produk wajib dipilih." }
  }

  return { data: { masterItemId, productId } }
}

export function productMappingRpcErrorMessage(message: string): string {
  const messages: Record<string, string> = {
    PRODUCT_MAPPING_ADMIN_REQUIRED:
      "Aksi ini hanya tersedia untuk admin aktif.",
    PRODUCT_MAPPING_EXISTS: "Produk sudah dipetakan ke Master Item ini.",
    PRODUCT_MAPPING_INPUT_INVALID: "Data Product Mapping tidak valid.",
    PRODUCT_MAPPING_MASTER_ITEM_NOT_FOUND: "Master Item aktif tidak ditemukan.",
    PRODUCT_MAPPING_NOT_FOUND: "Product Mapping tidak ditemukan.",
    PRODUCT_MAPPING_PRODUCT_NOT_FOUND: "Produk aktif tidak ditemukan.",
  }

  return (
    messages[message] ??
    "Aksi Product Mapping gagal. Coba lagi atau hubungi admin."
  )
}
