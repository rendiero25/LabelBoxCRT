export type DeliveryScheduleRow = {
  id: string
  /**
   * Kolom pertama file jadwal: ukuran produk -- misal
   * "VS-B T0.3XW100 L=120MM". Dibandingkan apa adanya dengan field kedua
   * string QR saat discan.
   */
  productSize: string
  qty: number
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

export type DeliveryScanOutcome = "pass" | "not_pass" | "unknown_label"

export type DeliveryScanResult = {
  deliveryOk: boolean
  message: string
  outcome: DeliveryScanOutcome | "error"
  verifiedCount: number
  totalCount: number
}
