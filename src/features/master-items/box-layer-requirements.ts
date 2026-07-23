export type BoxLayerRequirementInput = {
  productId: string
  expectedQty: number
}

type ParseResult =
  | { data: BoxLayerRequirementInput[] }
  | { error: string }

export function parseBoxLayerRequirementsInput(
  formData: FormData,
): ParseResult {
  const rawRequirements = String(formData.get("requirements") ?? "")
  let requirements: unknown

  try {
    requirements = JSON.parse(rawRequirements)
  } catch {
    return { error: "Requirement produk tidak valid." }
  }

  if (!Array.isArray(requirements)) {
    return { error: "Requirement produk tidak valid." }
  }
  if (requirements.length === 0) {
    return { error: "Minimal satu requirement wajib diisi." }
  }

  const parsedRequirements: BoxLayerRequirementInput[] = []
  const productIds = new Set<string>()

  for (const requirement of requirements) {
    if (!requirement || typeof requirement !== "object") {
      return { error: "Produk requirement wajib dipilih." }
    }

    const { productId, expectedQty } = requirement as {
      productId?: unknown
      expectedQty?: unknown
    }
    const normalizedProductId =
      typeof productId === "string" ? productId.trim() : ""
    const rawExpectedQty =
      typeof expectedQty === "string" || typeof expectedQty === "number"
        ? String(expectedQty).trim()
        : ""

    if (!normalizedProductId) {
      return { error: "Produk requirement wajib dipilih." }
    }
    if (productIds.has(normalizedProductId)) {
      return { error: "Produk requirement tidak boleh duplikat dalam satu layer." }
    }
    if (
      !/^\d+$/.test(rawExpectedQty) ||
      Number(rawExpectedQty) < 1 ||
      Number(rawExpectedQty) > 1_000_000
    ) {
      return {
        error: "Qty requirement harus berupa bilangan bulat lebih besar dari 0.",
      }
    }

    productIds.add(normalizedProductId)
    parsedRequirements.push({
      productId: normalizedProductId,
      expectedQty: Number(rawExpectedQty),
    })
  }

  return { data: parsedRequirements }
}

export function masterItemBoxRpcErrorMessage(message: string): string {
  const messages: Record<string, string> = {
    MASTER_ITEM_BOX_ADMIN_REQUIRED: "Aksi ini hanya tersedia untuk admin aktif.",
    MASTER_ITEM_BOX_MASTER_ITEM_NOT_FOUND:
      "Master Item tidak aktif atau tidak ditemukan.",
    MASTER_ITEM_BOX_LIMIT_REACHED: "Maksimal 3 Box per Master Item.",
    MASTER_ITEM_BOX_NOT_FOUND: "Box tidak ditemukan.",
    MASTER_ITEM_BOX_IN_USE: "Box sudah dipakai packing session dan terkunci.",
    MASTER_ITEM_BOX_INPUT_INVALID: "Data kebutuhan produk tidak valid.",
    MASTER_ITEM_BOX_PRODUCT_NOT_ALLOWED:
      "Produk requirement tidak diizinkan untuk Master Item ini.",
    BOX_LAYER_LIMIT_REACHED: "Maksimal 10 layer per Box.",
    BOX_LAYER_NOT_FOUND: "Layer tidak ditemukan.",
    BOX_LAYER_NOT_LAST:
      "Hanya layer terakhir yang bisa dihapus.",
  }

  return (
    messages[message] ??
    "Aksi Box/Layer Master Item gagal. Coba lagi atau hubungi admin."
  )
}
