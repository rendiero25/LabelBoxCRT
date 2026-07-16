const deliveryNumberPattern = /^[A-Z0-9][A-Z0-9_/-]{1,99}$/
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type DeliveryStatus = "draft" | "active"

type DeliveryNumberInput = {
  supplierId: string
  deliveryNumber: string
  deliveryDate: string
  status?: DeliveryStatus
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  )
}

export function parseDeliveryNumberInput(
  formData: FormData,
  options: { allowStatus?: boolean } = {},
): { data: DeliveryNumberInput } | { error: string } {
  const supplierId = String(formData.get("supplierId") ?? "").trim()
  const deliveryNumber = String(formData.get("deliveryNumber") ?? "")
    .trim()
    .toUpperCase()
  const deliveryDate = String(formData.get("deliveryDate") ?? "").trim()
  const rawStatus = String(formData.get("status") ?? "draft")

  if (!uuidPattern.test(supplierId)) return { error: "Supplier tidak valid." }
  if (!deliveryNumberPattern.test(deliveryNumber)) {
    return {
      error:
        "Delivery Number harus 2–100 karakter A–Z, angka, garis bawah, garis miring, atau tanda minus.",
    }
  }
  if (!isIsoDate(deliveryDate))
    return { error: "Tanggal delivery tidak valid." }

  if (!options.allowStatus) {
    return { data: { supplierId, deliveryNumber, deliveryDate } }
  }

  if (rawStatus !== "draft" && rawStatus !== "active") {
    return { error: "Status awal hanya dapat draft atau aktif." }
  }

  return {
    data: {
      supplierId,
      deliveryNumber,
      deliveryDate,
      status: rawStatus,
    },
  }
}

export function deliveryNumberRpcErrorMessage(message: string): string {
  const messages: Record<string, string> = {
    DELIVERY_NUMBER_ADMIN_REQUIRED:
      "Aksi ini hanya tersedia untuk admin aktif.",
    DELIVERY_NUMBER_EXISTS:
      "Delivery Number sudah digunakan untuk supplier ini.",
    DELIVERY_NUMBER_INPUT_INVALID: "Data Delivery Number tidak valid.",
    DELIVERY_NUMBER_NOT_FOUND: "Delivery Number tidak ditemukan.",
    DELIVERY_NUMBER_SUPPLIER_INVALID:
      "Supplier tidak aktif atau tidak ditemukan.",
    DELIVERY_NUMBER_TERMINAL:
      "Delivery Number yang closed atau cancelled tidak dapat diubah.",
    DELIVERY_NUMBER_STATUS_INVALID:
      "Perubahan status Delivery Number tidak valid.",
  }

  return (
    messages[message] ??
    "Aksi Delivery Number gagal. Coba lagi atau hubungi admin."
  )
}
