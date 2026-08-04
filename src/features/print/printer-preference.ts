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

/** Nama driver printer label Zebra pada Windows, misalnya "ZDesigner ZD220". */
const LABEL_PRINTER_PATTERN = /zdesigner|zebra|\bzd\d{3}\b/i

/**
 * Pilihan printer untuk alur cetak: pakai pilihan tersimpan bila masih ada,
 * kalau belum pernah memilih tebak printer labelnya. Tebakan hanya diambil
 * ketika jawabannya tunggal, karena mencetak ke printer yang salah berarti
 * label terbuang dan operator belum tentu sadar.
 *
 * Pilihan tersimpan yang hilang tetap menghasilkan null seperti resolvePrinter:
 * operator harus memilih ulang secara sadar, bukan diam-diam dialihkan.
 */
export function autoSelectPrinter(
  stored: string | null,
  discovered: string[],
): string | null {
  if (stored) return resolvePrinter(stored, discovered)

  const labelPrinters = discovered.filter((printer) =>
    LABEL_PRINTER_PATTERN.test(printer),
  )
  if (labelPrinters.length === 1) return labelPrinters[0]
  if (labelPrinters.length === 0 && discovered.length === 1) {
    return discovered[0]
  }

  return null
}
