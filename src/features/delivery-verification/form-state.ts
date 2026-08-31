export type DeliveryScheduleRow = {
  id: string
  /** Kolom Customer dokumen; null untuk jadwal lama yang belum memuatnya. */
  customer: string | null
  /**
   * Kolom "Item No" DO Report: ukuran produk seperti tertulis di label --
   * misal "VS-B T0.3XW100 L=120MM". Dibandingkan dengan field kedua string QR
   * saat discan.
   */
  productSize: string
  /**
   * Seluruh jumlah yang dikirim untuk ukuran ini, bukan isi satu box. Berapa
   * box yang menampungnya diisi operator di kolom Box.
   */
  qtyDelivery: number
  /**
   * Berapa box yang berangkat untuk baris ini, diisi operator. Null berarti
   * belum diisi: barisnya terlihat tetapi belum bisa discan, dan menahan
   * session tetap terbuka.
   */
  expectedBoxes: number | null
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
