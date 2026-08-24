export type DeliveryScheduleRow = {
  id: string
  /** Ukuran produk apa adanya dari file jadwal, misal "VS-B T0.3XW100 L=120MM". */
  productSize: string
  qty: number
  /**
   * Part No Master Item hasil terjemahan ukuran di atas, null kalau ukurannya
   * tidak menunjuk produk mana pun. Baris ber-null tidak akan pernah PASS, dan
   * operator perlu tahu itu saat mengunggah filenya -- bukan setelah seluruh
   * truk selesai discan.
   */
  resolvedPartNo: string | null
  rowNo: number
  sourceFileName: string
  verifiedAt: string | null
}

export type DeliverySession = {
  createdAt: string
  id: string
  rows: DeliveryScheduleRow[]
  sessionNo: number
  status: "open" | "done"
}

export type CreateDeliverySessionState = {
  error?: string
  success?: string
}

export const initialCreateDeliverySessionState: CreateDeliverySessionState = {}

export type UploadScheduleState = {
  error?: string
  success?: string
}

export const initialUploadScheduleState: UploadScheduleState = {}

export type DeliveryScanOutcome =
  "pass" | "not_pass" | "unknown_label" | "duplicate_label"

export type DeliveryScanResult = {
  deliveryOk: boolean
  message: string
  outcome: DeliveryScanOutcome | "error"
  verifiedCount: number
  totalCount: number
}
