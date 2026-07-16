export type MasterItemBoxRequirementsInput = {
  boxDefinitionId: string
  layers: {
    name: string
    requirements: { productId: string; expectedQty: number }[]
  }[]
}

type ParseResult = { data: MasterItemBoxRequirementsInput } | { error: string }

function parseLayers(
  rawLayers: string,
): MasterItemBoxRequirementsInput["layers"] | { error: string } {
  let layers: unknown

  try {
    layers = JSON.parse(rawLayers)
  } catch {
    return { error: "Layer box tidak valid." }
  }

  if (!Array.isArray(layers)) return { error: "Layer box tidak valid." }
  if (layers.length === 0) return { error: "Minimal satu layer wajib diisi." }
  if (layers.length > 10) return { error: "Maksimal 10 layer per box." }

  const parsedLayers: MasterItemBoxRequirementsInput["layers"] = []

  for (const layer of layers) {
    if (!layer || typeof layer !== "object") {
      return { error: "Layer box tidak valid." }
    }

    const { name, requirements } = layer as {
      name?: unknown
      requirements?: unknown
    }
    const normalizedName = typeof name === "string" ? name.trim() : ""

    if (!normalizedName) return { error: "Nama layer wajib diisi." }
    if (!Array.isArray(requirements) || requirements.length === 0) {
      return { error: "Minimal satu requirement wajib diisi." }
    }

    const parsedRequirements: MasterItemBoxRequirementsInput["layers"][number]["requirements"] =
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
      name: normalizedName,
      requirements: parsedRequirements,
    })
  }

  return parsedLayers
}

export function parseMasterItemBoxRequirementsInput(
  formData: FormData,
): ParseResult {
  const boxDefinitionId = String(formData.get("boxDefinitionId") ?? "").trim()
  const rawLayers = String(formData.get("layers") ?? "")

  if (!boxDefinitionId) return { error: "Box Definition wajib dipilih." }

  const layers = parseLayers(rawLayers)
  if ("error" in layers) return layers

  return { data: { boxDefinitionId, layers } }
}

export function masterItemBoxRequirementsRpcErrorMessage(
  message: string,
): string {
  const messages: Record<string, string> = {
    MASTER_ITEM_BOX_DEFINITION_MISMATCH:
      "Box Definition tidak sesuai dengan Master Item ini.",
    MASTER_ITEM_BOX_DEFINITION_IN_USE:
      "Definisi box sudah digunakan dan tidak dapat diubah.",
    MASTER_ITEM_BOX_REQUIREMENTS_INPUT_INVALID:
      "Data kebutuhan Box dan Layer tidak valid.",
    MASTER_ITEM_BOX_REQUIREMENTS_PRODUCT_INVALID:
      "Produk requirement tidak aktif atau tidak valid.",
    MASTER_ITEM_BOX_REQUIREMENTS_ADMIN_REQUIRED:
      "Aksi ini hanya tersedia untuk admin aktif.",
  }

  return (
    messages[message] ??
    "Aksi kebutuhan box Master Item gagal. Coba lagi atau hubungi admin."
  )
}
