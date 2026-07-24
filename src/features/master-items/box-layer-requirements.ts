export type BoxLayerRequirementInput = {
  productId: string
  expectedQty: number
}

export type LayerRequirementsEntry = {
  boxLayerId: string
  requirements: BoxLayerRequirementInput[]
}

type ParseAllResult = { data: LayerRequirementsEntry[] } | { error: string }

export function parseLayerRequirementsPayload(
  formData: FormData,
): ParseAllResult {
  const raw = String(formData.get("layerRequirements") ?? "").trim()
  if (!raw) return { data: [] }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return { error: "Data requirement layer tidak valid." }
  }
  if (!Array.isArray(payload)) {
    return { error: "Data requirement layer tidak valid." }
  }

  const entries: LayerRequirementsEntry[] = []

  for (const entry of payload) {
    if (!entry || typeof entry !== "object") {
      return { error: "Data requirement layer tidak valid." }
    }
    const { boxLayerId, productIds } = entry as {
      boxLayerId?: unknown
      productIds?: unknown
    }
    const normalizedBoxLayerId =
      typeof boxLayerId === "string" ? boxLayerId.trim() : ""
    if (!normalizedBoxLayerId || !Array.isArray(productIds)) {
      return { error: "Data requirement layer tidak valid." }
    }

    const normalizedProductIds = Array.from(
      new Set(
        productIds.filter(
          (productId): productId is string =>
            typeof productId === "string" && productId.trim().length > 0,
        ),
      ),
    )
    if (normalizedProductIds.length === 0) continue

    entries.push({
      boxLayerId: normalizedBoxLayerId,
      requirements: normalizedProductIds.map((productId) => ({
        productId,
        expectedQty: 1,
      })),
    })
  }

  return { data: entries }
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
