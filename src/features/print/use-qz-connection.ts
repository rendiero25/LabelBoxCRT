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

  const refreshPrinters = useCallback(async () => {
    try {
      setPrinters(await listPrinters())
    } catch {
      setPrinters([])
    }
  }, [])

  const connect = useCallback(async () => {
    const attempt = async (): Promise<void> => {
      setStatus("connecting")
      try {
        await connectQz()
        reconnectAttempt.current = 0
        setStatus("connected")
        await refreshPrinters()
      } catch {
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
    onQzClosed(() => {
      setStatus("disconnected")
      setPrinters([])
      reconnectTimer.current = setTimeout(() => void connect(), 2000)
    })
    void connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }
  }, [connect])

  return { connect, printers, refreshPrinters, status }
}
