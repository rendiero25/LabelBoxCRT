export type BoxLayerInput = {
  name: string
}

export type BoxInput = {
  boxName: string
  layers: BoxLayerInput[]
}

type ParseResult = { data: BoxInput } | { error: string }

function parseLayers(rawLayers: string): BoxLayerInput[] | { error: string } {
  let layers: unknown

  try {
    layers = JSON.parse(rawLayers)
  } catch {
    return { error: "Layer box tidak valid." }
  }

  if (!Array.isArray(layers)) return { error: "Layer box tidak valid." }
  if (layers.length === 0) return { error: "Minimal satu layer wajib diisi." }
  if (layers.length > 10) return { error: "Maksimal 10 layer per box." }

  const parsedLayers: BoxLayerInput[] = []

  for (const layer of layers) {
    if (!layer || typeof layer !== "object") {
      return { error: "Layer box tidak valid." }
    }

    const { name } = layer as { name?: unknown }
    const normalizedName = typeof name === "string" ? name.trim() : ""

    if (!normalizedName) return { error: "Nama layer wajib diisi." }
    if (normalizedName.length > 200) {
      return { error: "Nama layer maksimal 200 karakter." }
    }

    parsedLayers.push({ name: normalizedName })
  }

  return parsedLayers
}

export function parseBoxInput(formData: FormData): ParseResult {
  const boxName = String(formData.get("boxName") ?? "").trim()
  const rawLayers = String(formData.get("layers") ?? "")

  if (!boxName) return { error: "Nama box wajib diisi." }
  if (boxName.length > 200) return { error: "Nama box maksimal 200 karakter." }

  const layers = parseLayers(rawLayers)
  if ("error" in layers) return layers

  return { data: { boxName, layers } }
}

export function boxRpcErrorMessage(message: string): string {
  const messages: Record<string, string> = {
    BOX_ADMIN_REQUIRED: "Aksi ini hanya tersedia untuk admin aktif.",
    BOX_INPUT_INVALID: "Data box tidak valid.",
    BOX_CODE_EXISTS: "Kode box sudah digunakan.",
    BOX_NOT_FOUND: "Box tidak ditemukan.",
    BOX_IN_USE: "Box tidak dapat dihapus karena masih dipakai Master Item.",
  }

  return messages[message] ?? "Aksi box gagal. Coba lagi atau hubungi admin."
}
