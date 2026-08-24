export type DeliveryScheduleRow = {
  id: string
  partNo: string
  qty: number
  rowNo: number
  sourceFileName: string
  /** Terisi ketika satu label box cocok dengan baris ini (Bagian 2). */
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
