export type PrintJobPhase =
  | "idle"
  | "claiming"
  | "sending"
  | "completing"
  | "confirmed"
  | "failed"

export type PrintActionResult = {
  error?: string
  errorCode?: string
  jobStatus?: string
  sessionStatus?: string
  attemptNo?: number
}
