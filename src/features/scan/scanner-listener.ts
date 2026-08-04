export const SCANNER_MUTE_STORAGE_KEY = "label-box-crt.scanner-muted"

export type ScannerScanStatus = "success" | "error" | "duplicate"

export type ScannerSubmissionResult = {
  message?: string
  status: ScannerScanStatus
}

export type ScannerScanRecord = ScannerSubmissionResult & {
  rawPayload: string
  scannedAt: Date
}

export type ScannerListenerState = {
  buffer: string
  lastRawPayload: string | null
  lastScan: ScannerScanRecord | null
  pending: boolean
  recentScans: ScannerScanRecord[]
}

type ScannerEventTarget = {
  addEventListener: (type: string, listener: (event: Event) => void) => void
  removeEventListener: (type: string, listener: (event: Event) => void) => void
}

type ScannerStorage = Pick<Storage, "getItem" | "setItem">

export type ScannerListenerOptions = {
  maxRecentScans?: number
  onScan: (rawPayload: string) => Promise<ScannerSubmissionResult>
  onStateChange?: (state: ScannerListenerState) => void
  target: ScannerEventTarget
}

const initialState = (): ScannerListenerState => ({
  buffer: "",
  lastRawPayload: null,
  lastScan: null,
  pending: false,
  recentScans: [],
})

function getBrowserStorage(): ScannerStorage | undefined {
  if (typeof window === "undefined") {
    return undefined
  }

  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

const muteListeners = new Set<() => void>()

export function readScannerMutePreference(
  storage: ScannerStorage | undefined = getBrowserStorage(),
): boolean {
  try {
    return storage?.getItem(SCANNER_MUTE_STORAGE_KEY) === "true"
  } catch {
    return false
  }
}

export function writeScannerMutePreference(
  muted: boolean,
  storage: ScannerStorage | undefined = getBrowserStorage(),
) {
  try {
    storage?.setItem(SCANNER_MUTE_STORAGE_KEY, String(muted))
  } catch {
    // Browser privacy settings can deny localStorage. Mute remains in memory.
  }

  for (const listener of muteListeners) listener()
}

export function subscribeScannerMutePreference(callback: () => void) {
  muteListeners.add(callback)
  return () => muteListeners.delete(callback)
}

export function isScannerEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") {
    return false
  }

  const candidate = target as {
    closest?: (selector: string) => Element | null
    isContentEditable?: boolean
    tagName?: string
  }
  const tagName = candidate.tagName?.toLowerCase()

  if (
    candidate.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select"
  ) {
    return true
  }

  // Hanya dialog terbuka yang memblokir scan. Sebuah <form> biasa tidak,
  // karena halaman verifikasi memuat form penutup batch: memblokir seluruh
  // isinya membuat scan hilang tanpa pesan begitu fokus mendarat di tombolnya.
  return Boolean(candidate.closest?.("dialog[open]"))
}

function isPrintableScannerKey(event: KeyboardEvent) {
  return (
    event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey
  )
}

export class ScannerListener {
  private disposed = false
  private pendingCount = 0
  private queue: Promise<void> = Promise.resolve()
  private readonly maxRecentScans: number
  private state = initialState()

  constructor(private readonly options: ScannerListenerOptions) {
    this.maxRecentScans = Math.max(1, Math.floor(options.maxRecentScans ?? 5))
    options.target.addEventListener("keydown", this.handleKeydown)
  }

  clearRecentScans() {
    this.updateState({ lastScan: null, recentScans: [] })
  }

  dispose() {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.options.target.removeEventListener("keydown", this.handleKeydown)
    this.state = { ...this.state, buffer: "", pending: false }
  }

  getState(): ScannerListenerState {
    return this.snapshot()
  }

  resetBuffer() {
    if (this.state.buffer) {
      this.updateState({ buffer: "" })
    }
  }

  /**
   * Mengirim payload yang tidak datang dari ketikan di badan halaman, misalnya
   * dari kotak scan. Lewat antrean yang sama supaya bunyi, banner, dan riwayat
   * tidak punya dua sumber kebenaran.
   */
  async submit(rawPayload: string) {
    const payload = rawPayload.trim()
    if (!payload) return

    this.enqueue(payload)
    await this.queue
  }

  whenIdle() {
    return this.queue
  }

  private readonly handleKeydown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent

    if (isScannerEditableTarget(keyboardEvent.target)) {
      this.resetBuffer()
      return
    }

    if (keyboardEvent.key === "Enter") {
      if (!this.state.buffer) {
        return
      }

      keyboardEvent.preventDefault()
      this.enqueue(this.state.buffer)
      this.updateState({ buffer: "" })
      return
    }

    if (isPrintableScannerKey(keyboardEvent)) {
      this.updateState({ buffer: `${this.state.buffer}${keyboardEvent.key}` })
    }
  }

  private enqueue(rawPayload: string) {
    this.pendingCount += 1
    this.updateState({ lastRawPayload: rawPayload, pending: true })
    this.queue = this.queue.then(
      () => this.resolveScan(rawPayload),
      () => this.resolveScan(rawPayload),
    )
  }

  private async resolveScan(rawPayload: string) {
    let result: ScannerSubmissionResult

    try {
      result = await this.options.onScan(rawPayload)
    } catch {
      result = { message: "Scan gagal. Coba lagi.", status: "error" }
    }

    this.pendingCount -= 1

    if (this.disposed) {
      return
    }

    const scan: ScannerScanRecord = {
      ...result,
      rawPayload,
      scannedAt: new Date(),
    }
    this.updateState({
      lastScan: scan,
      pending: this.pendingCount > 0,
      recentScans: [scan, ...this.state.recentScans].slice(
        0,
        this.maxRecentScans,
      ),
    })
  }

  private snapshot(): ScannerListenerState {
    return {
      ...this.state,
      recentScans: [...this.state.recentScans],
    }
  }

  private updateState(next: Partial<ScannerListenerState>) {
    this.state = { ...this.state, ...next }

    if (!this.disposed) {
      this.options.onStateChange?.(this.snapshot())
    }
  }
}

export function createScannerListener(options: ScannerListenerOptions) {
  return new ScannerListener(options)
}
