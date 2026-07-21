export type MasterItemBoxLayerRequirementInput = {
  boxLayerId: string
  requirements: { productId: string; expectedQty: number }[]
}

type ParseResult =
  | { data: MasterItemBoxLayerRequirementInput[] }
  | { error: string }

export function parseMasterItemBoxLayersInput(
  formData: FormData,
): ParseResult {
  const rawLayers = String(formData.get("layers") ?? "")
  let layers: unknown

  try {
    layers = JSON.parse(rawLayers)
  } catch {
    return { error: "Layer box tidak valid." }
  }

  if (!Array.isArray(layers)) return { error: "Layer box tidak valid." }
  if (layers.length === 0) return { error: "Minimal satu layer wajib diisi." }
  if (layers.length > 10) return { error: "Maksimal 10 layer per box." }

  const parsedLayers: MasterItemBoxLayerRequirementInput[] = []

  for (const layer of layers) {
    if (!layer || typeof layer !== "object") {
      return { error: "Layer box tidak valid." }
    }

    const { boxLayerId, requirements } = layer as {
      boxLayerId?: unknown
      requirements?: unknown
    }
    const normalizedBoxLayerId =
      typeof boxLayerId === "string" ? boxLayerId.trim() : ""

    if (!normalizedBoxLayerId) return { error: "Layer box tidak valid." }
    if (!Array.isArray(requirements) || requirements.length === 0) {
      return { error: "Minimal satu requirement wajib diisi." }
    }

    const parsedRequirements: MasterItemBoxLayerRequirementInput["requirements"] =
      []
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
        return {
          error: "Produk requirement tidak boleh duplikat dalam satu layer.",
        }
      }
      if (
        !/^\d+$/.test(rawExpectedQty) ||
        Number(rawExpectedQty) < 1 ||
        Number(rawExpectedQty) > 1_000_000
      ) {
        return {
          error:
            "Qty requirement harus berupa bilangan bulat lebih besar dari 0.",
        }
      }

      productIds.add(normalizedProductId)
      parsedRequirements.push({
        productId: normalizedProductId,
        expectedQty: Number(rawExpectedQty),
      })
    }

    parsedLayers.push({
      boxLayerId: normalizedBoxLayerId,
      requirements: parsedRequirements,
    })
  }

  return { data: parsedLayers }
}

export function masterItemBoxRpcErrorMessage(message: string): string {
  const messages: Record<string, string> = {
    MASTER_ITEM_BOX_ADMIN_REQUIRED: "Aksi ini hanya tersedia untuk admin aktif.",
    MASTER_ITEM_BOX_MASTER_ITEM_NOT_FOUND:
      "Master Item tidak aktif atau tidak ditemukan.",
    MASTER_ITEM_BOX_BOX_NOT_FOUND: "Box tidak aktif atau tidak ditemukan.",
    MASTER_ITEM_BOX_INPUT_INVALID: "Data kebutuhan Box dan Layer tidak valid.",
    MASTER_ITEM_BOX_LAYER_NOT_ALLOWED: "Layer tidak sesuai dengan box terpilih.",
    MASTER_ITEM_BOX_PRODUCT_NOT_ALLOWED:
      "Produk requirement tidak diizinkan untuk Master Item ini.",
    MASTER_ITEM_BOX_EXISTS:
      "Master Item ini sudah memakai box tersebut. Edit assignment yang ada.",
    MASTER_ITEM_BOX_NOT_FOUND: "Assignment box tidak ditemukan.",
    MASTER_ITEM_BOX_MISMATCH: "Assignment box tidak sesuai dengan Master Item ini.",
    MASTER_ITEM_BOX_IN_USE: "Assignment box sudah digunakan dan tidak dapat diubah.",
    MASTER_ITEM_BOX_INVALID: "Assignment box belum valid untuk diaktifkan.",
  }

  return (
    messages[message] ??
    "Aksi kebutuhan box Master Item gagal. Coba lagi atau hubungi admin."
  )
}
