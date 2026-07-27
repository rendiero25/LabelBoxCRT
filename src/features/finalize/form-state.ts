import type { FinalizedLabelSnapshot } from "@/lib/label/formatter"

export type FinalizeSnapshot = FinalizedLabelSnapshot & {
  alreadyFinalized: boolean
  lotNo: string
  packingSessionId: string
  printJobId: string
  qtyDelivery: number
  sessionStatus: string
}

export type FinalizePackingSessionActionState = {
  error?: string
  snapshot?: FinalizeSnapshot
  success?: string
}

export const initialFinalizePackingSessionActionState: FinalizePackingSessionActionState =
  {}
