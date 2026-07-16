export type WorkstationActionState = {
  error?: string
  success?: string
  enrollmentCode?: string
  enrollmentExpiresAt?: string
}

export const initialWorkstationActionState: WorkstationActionState = {}
