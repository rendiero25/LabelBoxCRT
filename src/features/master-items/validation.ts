const itemCodePattern = /^[a-z0-9][a-z0-9_-]{1,63}$/
const partNoPattern = /^[A-Z0-9][A-Z0-9_./-]{1,127}$/
const unitPattern = /^[A-Za-z][A-Za-z ./-]{0,31}$/
const sequenceCodePattern = /^[A-Z0-9][A-Z0-9_-]{1,63}$/

type MasterItemInput = {
  itemCode: string
  partNo: string
  partName: string
  unit: string
  defaultLabelQty: number
  itemSequenceCode: string | null
}

function normalizeUnit(value: string): string {
  const normalized = value.trim().toLowerCase()
  return normalized
    ? `${normalized[0].toUpperCase()}${normalized.slice(1)}`
    : ""
}

export function parseMasterItemInput(
  formData: FormData,
): { data: MasterItemInput } | { error: string } {
  const itemCode = String(formData.get("itemCode") ?? "")
    .trim()
    .toLowerCase()
  const partNo = String(formData.get("partNo") ?? "")
    .trim()
    .toUpperCase()
  const partName = String(formData.get("partName") ?? "").trim()
  const unit = normalizeUnit(String(formData.get("unit") ?? ""))
  const rawQuantity = String(formData.get("defaultLabelQty") ?? "").trim()
  const sequenceCode = String(formData.get("itemSequenceCode") ?? "")
    .trim()
    .toUpperCase()

  if (!itemCodePattern.test(itemCode)) {
    return {
      error:
        "Kode item harus 2–64 karakter huruf kecil, angka, garis bawah, atau tanda minus.",
    }
  }
  if (!partNoPattern.test(partNo)) {
    return {
      error:
        "Part No harus 2–128 karakter huruf besar, angka, titik, garis bawah, garis miring, atau tanda minus.",
    }
  }
  if (!partName) return { error: "Nama part wajib diisi." }
  if (partName.length > 200)
    return { error: "Nama part maksimal 200 karakter." }
  if (!unitPattern.test(unit)) return { error: "Unit tidak valid." }
  if (!/^[1-9]\d{0,5}$/.test(rawQuantity)) {
    return {
      error:
        "Default label Qty harus berupa bilangan bulat lebih besar dari 0.",
    }
  }
  if (sequenceCode && !sequenceCodePattern.test(sequenceCode)) {
    return {
      error:
        "Kode sequence harus 2–64 karakter A–Z, angka, garis bawah, atau tanda minus.",
    }
  }

  return {
    data: {
      itemCode,
      partNo,
      partName,
      unit,
      defaultLabelQty: Number(rawQuantity),
      itemSequenceCode: sequenceCode || null,
    },
  }
}

export function masterItemRpcErrorMessage(message: string): string {
  const messages: Record<string, string> = {
    MASTER_ITEM_ADMIN_REQUIRED: "Aksi ini hanya tersedia untuk admin aktif.",
    MASTER_ITEM_CODE_EXISTS: "Kode item sudah digunakan.",
    MASTER_ITEM_IN_USE:
      "Master Item sudah memiliki session dan tidak dapat diubah.",
    MASTER_ITEM_INPUT_INVALID: "Data Master Item tidak valid.",
    MASTER_ITEM_NOT_FOUND: "Master Item tidak ditemukan.",
    MASTER_ITEM_PART_NO_EXISTS: "Part No sudah digunakan.",
  }

  return (
    messages[message] ?? "Aksi Master Item gagal. Coba lagi atau hubungi admin."
  )
}
