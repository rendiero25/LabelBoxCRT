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
  /** Nama operator yang mengepak; dicetak di baris Operator Pack label. */
  operatorName: string
  packingDate: string
  partName: string
  partNo: string
  printJobId: string
  qrPayload: string
  /** Qty/Box milik Master Item, dicetak di baris Qty/Box. */
  qty: number
  /**
   * Qty Delivery batch: penentu jumlah set label sekaligus angka yang dicetak
   * di baris Qty/Delivery. Dulu baris itu memakai kolom terpisah
   * (qty_delivery_display) yang diisi lewat field "Packing Qty" di formulir.
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
