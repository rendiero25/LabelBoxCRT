import { describe, expect, it, vi } from "vitest"

import {
  createScannerListener,
  readScannerMutePreference,
  writeScannerMutePreference,
} from "@/features/scan/scanner-listener"

class FakeKeyboardTarget {
  private readonly listeners = new Set<(event: Event) => void>()

  addEventListener(_type: string, listener: (event: Event) => void) {
    this.listeners.add(listener)
  }

  removeEventListener(_type: string, listener: (event: Event) => void) {
    this.listeners.delete(listener)
  }

  key(key: string, target: EventTarget | null = null) {
    const event = {
      altKey: false,
      ctrlKey: false,
      key,
      metaKey: false,
      preventDefault: vi.fn(),
      target,
    } as unknown as Event

    for (const listener of this.listeners) {
      listener(event)
    }

    return event
  }
}

function typeScan(target: FakeKeyboardTarget, payload: string) {
  for (const character of payload) {
    target.key(character)
  }

  target.key("Enter")
}

describe("scanner listener", () => {
  it("buffers printable keys and submits only when Enter terminates the payload", async () => {
    const target = new FakeKeyboardTarget()
    const onScan = vi.fn(async () => ({ status: "success" as const }))
    const listener = createScannerListener({ onScan, target })

    target.key("Q")
    target.key("R")

    expect(onScan).not.toHaveBeenCalled()
    expect(listener.getState().buffer).toBe("QR")

    target.key("Enter")
    await listener.whenIdle()

    expect(onScan).toHaveBeenCalledWith("QR")
    expect(listener.getState()).toMatchObject({
      buffer: "",
      lastRawPayload: "QR",
      pending: false,
    })
    expect(listener.getState().lastScan).toMatchObject({
      rawPayload: "QR",
      status: "success",
    })
  })

  it.each([
    { isContentEditable: false, tagName: "INPUT" },
    { isContentEditable: false, tagName: "TEXTAREA" },
    { isContentEditable: false, tagName: "SELECT" },
    { isContentEditable: true, tagName: "DIV" },
    {
      closest: () => ({ tagName: "DIALOG" }),
      isContentEditable: false,
      tagName: "BUTTON",
    },
  ])(
    "ignores scanner events from editable controls",
    async (editableTarget) => {
      const target = new FakeKeyboardTarget()
      const onScan = vi.fn(async () => ({ status: "success" as const }))
      const listener = createScannerListener({ onScan, target })

      target.key("Q", editableTarget as unknown as EventTarget)
      target.key("Enter", editableTarget as unknown as EventTarget)
      await listener.whenIdle()

      expect(onScan).not.toHaveBeenCalled()
      expect(listener.getState().buffer).toBe("")
    },
  )

  // Kartu "Selesaikan verifikasi" adalah <form>, jadi memperlakukan seluruh isi
  // form sebagai kolom ketik membuat scan hilang tanpa jejak begitu fokus
  // mendarat di tombolnya.
  it("keeps scanning while a plain button inside a form holds focus", async () => {
    const target = new FakeKeyboardTarget()
    const onScan = vi.fn(async () => ({ status: "success" as const }))
    const listener = createScannerListener({ onScan, target })
    const buttonInsideForm = {
      closest: (selector: string) =>
        selector.includes("form") ? { tagName: "FORM" } : null,
      isContentEditable: false,
      tagName: "BUTTON",
    }

    target.key("Q", buttonInsideForm as unknown as EventTarget)
    target.key("Enter", buttonInsideForm as unknown as EventTarget)
    await listener.whenIdle()

    expect(onScan).toHaveBeenCalledWith("Q")
  })

  /**
   * Spasi pada tombol yang sedang terfokus menekan tombol itu. Payload QR label
   * box memuat spasi (`10015|TB 3210A-K1Z-NF01-DL|...`), jadi tanpa
   * preventDefault, scan yang ditembak sesaat setelah operator menekan sebuah
   * tombol akan menekan tombol itu lagi di tengah payload -- dan kalau tombol
   * itu yang menyalakan scan, scannya mati sendiri sebelum Enter datang.
   */
  it("suppresses the default action of buffered keys so a focused button is not activated", () => {
    const target = new FakeKeyboardTarget()
    const onScan = vi.fn(async () => ({ status: "success" as const }))
    createScannerListener({ onScan, target })

    const focusedButton = {
      closest: () => null,
      isContentEditable: false,
      tagName: "BUTTON",
    } as unknown as EventTarget

    const space = target.key(" ", focusedButton)
    expect(space.preventDefault).toHaveBeenCalled()

    const letter = target.key("Q", focusedButton)
    expect(letter.preventDefault).toHaveBeenCalled()
  })

  // Ketikan di kolom teks bukan urusan scanner, jadi ia tidak boleh ikut
  // ditahan -- menahannya berarti kolomnya tidak bisa diketik sama sekali.
  it("leaves typing in an editable control untouched", () => {
    const target = new FakeKeyboardTarget()
    const onScan = vi.fn(async () => ({ status: "success" as const }))
    createScannerListener({ onScan, target })

    const input = {
      closest: () => null,
      isContentEditable: false,
      tagName: "INPUT",
    } as unknown as EventTarget

    const typed = target.key("Q", input)
    expect(typed.preventDefault).not.toHaveBeenCalled()
  })

  // Kotak scan di halaman verifikasi mengirim lewat jalur yang sama dengan
  // ketikan langsung, supaya bunyi, banner, dan riwayat scan tetap satu sumber.
  it("submits a payload handed to it without any keystrokes", async () => {
    const target = new FakeKeyboardTarget()
    const onScan = vi.fn(async () => ({ status: "success" as const }))
    const listener = createScannerListener({ onScan, target })

    await listener.submit("QR-FROM-INPUT")
    await listener.whenIdle()

    expect(onScan).toHaveBeenCalledWith("QR-FROM-INPUT")
    expect(listener.getState().lastScan).toMatchObject({
      rawPayload: "QR-FROM-INPUT",
      status: "success",
    })
  })

  it("serializes scanner payloads while the previous async decision is pending", async () => {
    const target = new FakeKeyboardTarget()
    const calls: string[] = []
    let releaseFirst: (() => void) | undefined
    let startedFirst: (() => void) | undefined
    const firstStarted = new Promise<void>((resolve) => {
      startedFirst = resolve
    })
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const listener = createScannerListener({
      onScan: async (payload) => {
        calls.push(payload)
        if (payload === "FIRST") {
          startedFirst?.()
          await firstFinished
        }

        return { status: "success" as const }
      },
      target,
    })

    typeScan(target, "FIRST")
    typeScan(target, "SECOND")
    await firstStarted

    expect(calls).toEqual(["FIRST"])
    expect(listener.getState().pending).toBe(true)

    releaseFirst?.()
    await listener.whenIdle()

    expect(calls).toEqual(["FIRST", "SECOND"])
    expect(listener.getState().pending).toBe(false)
  })

  it("records duplicate and thrown errors as actionable scan states", async () => {
    const target = new FakeKeyboardTarget()
    const listener = createScannerListener({
      onScan: async (payload) => {
        if (payload === "DUPLICATE") {
          return { message: "Label sudah pernah discan.", status: "duplicate" }
        }

        throw new Error("network unavailable")
      },
      target,
    })

    typeScan(target, "DUPLICATE")
    await listener.whenIdle()
    typeScan(target, "ERROR")
    await listener.whenIdle()

    expect(listener.getState().lastScan).toMatchObject({
      message: "Scan gagal. Coba lagi.",
      rawPayload: "ERROR",
      status: "error",
    })
    expect(listener.getState().recentScans).toEqual([
      expect.objectContaining({ rawPayload: "ERROR", status: "error" }),
      expect.objectContaining({ rawPayload: "DUPLICATE", status: "duplicate" }),
    ])
  })

  it("resets an unfinished buffer and stops receiving events after disposal", async () => {
    const target = new FakeKeyboardTarget()
    const onScan = vi.fn(async () => ({ status: "success" as const }))
    const listener = createScannerListener({ onScan, target })

    target.key("Q")
    listener.resetBuffer()
    target.key("Enter")
    await listener.whenIdle()
    listener.dispose()
    typeScan(target, "AFTER-DISPOSE")
    await listener.whenIdle()

    expect(onScan).not.toHaveBeenCalled()
    expect(listener.getState().buffer).toBe("")
  })
})

describe("scanner mute preference", () => {
  it("persists a mute preference without throwing when browser storage is unavailable", () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }

    expect(readScannerMutePreference(storage)).toBe(false)
    writeScannerMutePreference(true, storage)
    expect(readScannerMutePreference(storage)).toBe(true)
    expect(() =>
      writeScannerMutePreference(false, {
        getItem: () => {
          throw new Error("blocked")
        },
        setItem: () => {
          throw new Error("blocked")
        },
      }),
    ).not.toThrow()
  })
})
