export type DeliveryScheduleRow = {
  id: string
  /**
   * Kolom pertama file jadwal: ukuran produk -- misal
   * "VS-B T0.3XW100 L=120MM". Dibandingkan apa adanya dengan field kedua
   * string QR saat discan.
   */
  productSize: string
  /**
   * Seluruh jumlah yang dikirim untuk ukuran ini, bukan isi satu box. Berapa
   * box yang menampungnya ditentukan mpqQty.
   */
  qtyDelivery: number
  /** MPQ ukuran ini, disalin dari MPQ Sheet saat jadwal diunggah. */
  mpqQty: number
  /** Dibulatkan ke atas: sisa yang tidak penuh tetap minta satu box sendiri. */
  expectedBoxes: number
  verifiedBoxes: number
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
  /** Box, bukan baris jadwal: itu yang dihitung operator sambil membongkar. */
  verifiedCount: number
  totalCount: number
}
