export type GeneratedLabelBox = {
  boxNumber: string
  qrPayload: string
}

export type LabelBoxBatchResult = {
  deliveryDate: string
  deliveryNumber: string
  itemCode: string
  labelBoxes: GeneratedLabelBox[]
  labelCount: number
  lotNo: string
  masterItemRowNo: number
  packingQty: number
  qtyDelivery: number
  supplierCode: string
}

export type LabelBoxBatchActionState = {
  error?: string
  result?: LabelBoxBatchResult
  success?: string
}

export const initialLabelBoxBatchActionState: LabelBoxBatchActionState = {}
