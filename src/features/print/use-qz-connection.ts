"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  connectQz,
  listPrinters,
  onQzClosed,
} from "@/features/print/qz-client"

export type QzConnectionStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error"

const RECONNECT_DELAYS_MS = [2000, 5000, 10000, 30000]

export function useQzConnection() {
  const [status, setStatus] = useState<QzConnectionStatus>("disconnected")
  const [printers, setPrinters] = useState<string[]>([])
  const reconnectAttempt = useRef(0)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disposed = useRef(false)

  const refreshPrinters = useCallback(async () => {
    try {
      const found = await listPrinters()
      if (disposed.current) return
      setPrinters(found)
    } catch {
      if (disposed.current) return
      setPrinters([])
    }
  }, [])

  const connect = useCallback(async () => {
    const attempt = async (): Promise<void> => {
      if (disposed.current) return
      setStatus("connecting")
      try {
        await connectQz()
        if (disposed.current) return
        reconnectAttempt.current = 0
        setStatus("connected")
        await refreshPrinters()
      } catch {
        if (disposed.current) return
        setStatus("error")
        const delay =
          RECONNECT_DELAYS_MS[
            Math.min(reconnectAttempt.current, RECONNECT_DELAYS_MS.length - 1)
          ]
        reconnectAttempt.current += 1
        reconnectTimer.current = setTimeout(() => void attempt(), delay)
      }
    }
    await attempt()
  }, [refreshPrinters])

  useEffect(() => {
    disposed.current = false
    const unsubscribeClosed = onQzClosed(() => {
      if (disposed.current) return
      setStatus("disconnected")
      setPrinters([])
      reconnectTimer.current = setTimeout(() => void connect(), 2000)
    })
    void connect()
    return () => {
      disposed.current = true
      unsubscribeClosed()
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [connect])

  return { connect, printers, refreshPrinters, status }
}
