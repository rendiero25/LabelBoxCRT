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
