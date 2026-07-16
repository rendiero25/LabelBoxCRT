export type BoxLayerInput = {
  name: string
  requirements: {
    productId: string
    expectedQty: number
  }[]
}

export type BoxDefinitionInput = {
  masterItemId: string
  boxCode: string
  boxName: string
  layers: BoxLayerInput[]
}

type ParseResult = { data: BoxDefinitionInput } | { error: string }

function parseLayers(rawLayers: string): BoxLayerInput[] | { error: string } {
  let layers: unknown

  try {
    layers = JSON.parse(rawLayers)
  } catch {
    return { error: "Layer box tidak valid." }
  }

  if (!Array.isArray(layers)) return { error: "Layer box tidak valid." }
  if (layers.length === 0) return { error: "Minimal satu layer wajib diisi." }

  const parsedLayers: BoxLayerInput[] = []

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

    const parsedRequirements: BoxLayerInput["requirements"] = []

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
      const rawExpectedQty = String(expectedQty ?? "").trim()

      if (!normalizedProductId) {
        return { error: "Produk requirement wajib dipilih." }
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

      parsedRequirements.push({
        productId: normalizedProductId,
        expectedQty: Number(rawExpectedQty),
      })
    }

    parsedLayers.push({ name: normalizedName, requirements: parsedRequirements })
  }

  return parsedLayers
}

export function parseBoxDefinitionInput(formData: FormData): ParseResult {
  const masterItemId = String(formData.get("masterItemId") ?? "").trim()
  const boxCode = String(formData.get("boxCode") ?? "")
    .trim()
    .toUpperCase()
  const boxName = String(formData.get("boxName") ?? "").trim()
  const rawLayers = String(formData.get("layers") ?? "")

  if (!masterItemId) return { error: "Master Item wajib dipilih." }
  if (!boxCode) return { error: "Kode box wajib diisi." }
  if (boxCode.length > 64) return { error: "Kode box maksimal 64 karakter." }
  if (!boxName) return { error: "Nama box wajib diisi." }
  if (boxName.length > 200) return { error: "Nama box maksimal 200 karakter." }

  const layers = parseLayers(rawLayers)
  if ("error" in layers) return layers

  return { data: { masterItemId, boxCode, boxName, layers } }
}

export function boxDefinitionRpcErrorMessage(message: string): string {
  const messages: Record<string, string> = {
    BOX_DEFINITION_ADMIN_REQUIRED: "Aksi ini hanya tersedia untuk admin aktif.",
    BOX_DEFINITION_INPUT_INVALID: "Data definisi box tidak valid.",
    BOX_DEFINITION_IN_USE:
      "Definisi box sudah digunakan dan tidak dapat diubah.",
    BOX_DEFINITION_NOT_FOUND: "Definisi box tidak ditemukan.",
    BOX_DEFINITION_VERSION_EXISTS: "Versi definisi box sudah ada.",
    BOX_DEFINITION_INVALID: "Definisi box belum valid untuk diaktifkan.",
    BOX_DEFINITION_PRODUCT_NOT_ALLOWED:
      "Produk requirement tidak diizinkan untuk Master Item ini.",
  }

  return (
    messages[message] ?? "Aksi definisi box gagal. Coba lagi atau hubungi admin."
  )
}
