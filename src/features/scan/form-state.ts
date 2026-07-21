export type PackingSessionActionState = {
  error?: string
  success?: string
}

export const initialPackingSessionActionState: PackingSessionActionState = {}

export type AcceptPackingScanInput = {
  packingSessionId: string
  rawPayload: string
}

export type AcceptPackingScanActionResult = {
  message: string
  status: "duplicate" | "error" | "success"
}
