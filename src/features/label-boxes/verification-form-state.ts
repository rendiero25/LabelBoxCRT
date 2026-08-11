export type LabelBoxScanResult = {
  boxNumber: string
  labelBoxId: string
  labelBoxStatus: "generated" | "verified"
  layerAcceptedQty: number
  layerExpectedQty: number
  message: string
  status: "duplicate" | "error" | "success"
  totalAcceptedQty: number
  totalExpectedQty: number
}

export type LabelBoxScanInput = {
  batchId: string
  rawPayload: string
}

export type CloseLabelBoxBatchActionState = {
  error?: string
  success?: string
}

export const initialCloseLabelBoxBatchActionState: CloseLabelBoxBatchActionState =
  {}

export type LabelBoxPrintJob = {
  boxName: string
  boxNumber: string
  deliveryDate: string
  deliveryNumber: string
  labelBoxId: string
  labelReference: string
  lotNo: string
  masterItemRowNo: number
  packingDate: string
  partName: string
  partNo: string
  printJobId: string
  qrPayload: string
  qty: number
  /**
   * Angka yang dicetak di baris Qty/Delivery. Bukan qty_delivery batch — kolom
   * itu keping yang dipak, yaitu penentu jumlah label.
   */
  qtyDelivery: number
  status: string
  supplierCode: string
  /** Nama supplier; dicetak di baris Customer pada label box. */
  supplierName: string
}

export type LabelBoxPrintJobsActionState = {
  error?: string
  jobs?: LabelBoxPrintJob[]
  success?: string
}

export const initialLabelBoxPrintJobsActionState: LabelBoxPrintJobsActionState =
  {}
