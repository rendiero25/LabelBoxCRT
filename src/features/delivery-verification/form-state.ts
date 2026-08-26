export type DeliveryScheduleRow = {
  id: string
  /**
   * Kolom pertama file jadwal: Part No label sheet, yang isinya ukuran --
   * misal "VS-B T0.3XW100 L=120MM". Dibandingkan apa adanya dengan Part No
   * yang dibawa label saat discan.
   */
  productSize: string
  qty: number
  /**
   * Sudah ada label yang membawa Part No dan Qty per Box ini. Bukan syarat
   * PASS -- ia menjawab lebih awal pertanyaan yang kalau tidak dijawab baru
   * ketahuan setelah seluruh truk discan: apakah labelnya memang sudah dibuat.
   */
  matchingBatchExists: boolean
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
