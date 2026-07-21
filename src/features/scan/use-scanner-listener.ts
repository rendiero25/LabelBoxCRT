"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import {
  createScannerListener,
  readScannerMutePreference,
  subscribeScannerMutePreference,
  type ScannerListenerState,
  type ScannerSubmissionResult,
  writeScannerMutePreference,
} from "@/features/scan/scanner-listener"

const emptyState = (): ScannerListenerState => ({
  buffer: "",
  lastRawPayload: null,
  lastScan: null,
  pending: false,
  recentScans: [],
})

function getScannerMuteServerSnapshot() {
  return false
}

export type UseScannerListenerOptions = {
  enabled?: boolean
  maxRecentScans?: number
  onScan: (rawPayload: string) => Promise<ScannerSubmissionResult>
}

export function useScannerListener({
  enabled = true,
  maxRecentScans,
  onScan,
}: UseScannerListenerOptions) {
  const listenerRef = useRef<ReturnType<typeof createScannerListener> | null>(
    null,
  )
  const onScanRef = useRef(onScan)
  const [state, setState] = useState<ScannerListenerState>(emptyState)
  const muted = useSyncExternalStore(
    subscribeScannerMutePreference,
    readScannerMutePreference,
    getScannerMuteServerSnapshot,
  )

  useEffect(() => {
    onScanRef.current = onScan
  }, [onScan])

  useEffect(() => {
    if (!enabled) {
      listenerRef.current = null
      return
    }

    const listener = createScannerListener({
      maxRecentScans,
      onScan: (rawPayload) => onScanRef.current(rawPayload),
      onStateChange: setState,
      target: window,
    })

    listenerRef.current = listener
    setState(listener.getState())

    return () => {
      listener.dispose()
      if (listenerRef.current === listener) {
        listenerRef.current = null
      }
    }
  }, [enabled, maxRecentScans])

  const setMuted = useCallback((nextMuted: boolean) => {
    writeScannerMutePreference(nextMuted)
  }, [])

  return {
    ...(enabled ? state : emptyState()),
    clearRecentScans: () => listenerRef.current?.clearRecentScans(),
    muted,
    resetBuffer: () => listenerRef.current?.resetBuffer(),
    setMuted,
  }
}
