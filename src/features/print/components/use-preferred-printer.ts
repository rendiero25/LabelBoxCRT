"use client"

import { useSyncExternalStore } from "react"

import {
  readPreferredPrinter,
  savePreferredPrinter,
} from "@/features/print/printer-preference"

/**
 * Hydration-safe, reactive view of the preferred printer stored in
 * localStorage. The server snapshot is always null so the first client
 * render matches SSR markup; the real value appears after hydration.
 * Same-tab writes go through setPreferredPrinter (which notifies via a
 * custom event); cross-tab writes arrive via the native storage event.
 */
const CHANGE_EVENT = "labelbox:printer-preference"

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback)
  window.addEventListener(CHANGE_EVENT, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(CHANGE_EVENT, callback)
  }
}

function getServerSnapshot(): string | null {
  return null
}

export function usePreferredPrinter(): string | null {
  return useSyncExternalStore(
    subscribe,
    readPreferredPrinter,
    getServerSnapshot,
  )
}

export function setPreferredPrinter(printerName: string): void {
  savePreferredPrinter(printerName)
  window.dispatchEvent(new Event(CHANGE_EVENT))
}
