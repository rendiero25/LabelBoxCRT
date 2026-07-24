"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"

export type ActionStateToastState = {
  error?: string
  success?: string
}

export function actionStateToast(state: ActionStateToastState) {
  if (state.error) return { type: "error" as const, message: state.error }
  if (state.success) return { type: "success" as const, message: state.success }
  return null
}

export function useActionStateToast(state: ActionStateToastState) {
  const previousState = useRef<ActionStateToastState | null>(null)

  useEffect(() => {
    if (previousState.current === state) return
    previousState.current = state

    const notification = actionStateToast(state)
    if (!notification) return

    toast[notification.type](notification.message)
  }, [state])
}

/**
 * Closes a dialog on a successful action state. Without this, a dialog left
 * open after a successful create keeps stale form values that can collide
 * with the freshly revalidated list (e.g. a duplicate-check matching the
 * record just created against itself).
 */
export function useCloseOnActionSuccess(
  state: ActionStateToastState,
  close: () => void,
) {
  const previousState = useRef<ActionStateToastState | null>(null)

  useEffect(() => {
    if (previousState.current === state) return
    previousState.current = state
    if (state.success) close()
  }, [state, close])
}
