"use client"

import { useEffect } from "react"
import { toast } from "sonner"

export function WorkstationHeartbeat() {
  useEffect(() => {
    let warned = false

    const heartbeat = async () => {
      const response = await fetch("/api/workstation/heartbeat", {
        cache: "no-store",
        method: "POST",
      })

      if (!response.ok && !warned) {
        warned = true
        toast.error("Identitas workstation tidak lagi valid. Hubungi admin.")
      }
    }

    void heartbeat()
    const interval = window.setInterval(() => void heartbeat(), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  return null
}
