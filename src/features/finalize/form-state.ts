import type { FinalizedLabelSnapshot } from "@/lib/label/formatter"

export type FinalizeSnapshot = FinalizedLabelSnapshot & {
  alreadyFinalized: boolean
  packingSessionId: string
  printJobId: string
  sessionStatus: string
}

export type FinalizePackingSessionActionState = {
  error?: string
  snapshot?: FinalizeSnapshot
  success?: string
}

export const initialFinalizePackingSessionActionState: FinalizePackingSessionActionState =
  {}
