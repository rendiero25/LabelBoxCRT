export const PRINTER_STORAGE_KEY = "labelbox.printerName"

export function readPreferredPrinter(): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(PRINTER_STORAGE_KEY)
}

export function savePreferredPrinter(printerName: string): void {
  window.localStorage.setItem(PRINTER_STORAGE_KEY, printerName)
}

export function clearPreferredPrinter(): void {
  window.localStorage.removeItem(PRINTER_STORAGE_KEY)
}

/**
 * A stored printer is only usable when it is still present in the list QZ
 * discovered. Missing → null: the UI must force an explicit re-pick. Never
 * fall back to another printer (spec D6).
 */
export function resolvePrinter(
  stored: string | null,
  discovered: string[],
): string | null {
  if (!stored) return null
  return discovered.includes(stored) ? stored : null
}
