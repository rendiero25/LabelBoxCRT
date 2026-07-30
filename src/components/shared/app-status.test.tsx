// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AppStatus } from "@/components/shared/app-status"

const mocks = vi.hoisted(() => ({
  readPreferredPrinter: vi.fn<() => string | null>(() => null),
  useQzConnection: vi.fn(() => ({
    connect: vi.fn(),
    printers: [] as string[],
    refreshPrinters: vi.fn(),
    refreshScanner: vi.fn(),
    scanner: null as { product?: string } | null,
    status: "disconnected" as const,
  })),
}))

const zebraScanner = { product: "Symbol Bar Code Scanner DS2208" }

vi.mock("@/features/print/use-qz-connection", () => ({
  useQzConnection: mocks.useQzConnection,
}))

// resolvePrinter stays real: deciding that a stored printer which QZ no longer
// reports does not count as ready is the behaviour these tests exercise.
vi.mock("@/features/print/printer-preference", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/print/printer-preference")
  >()),
  readPreferredPrinter: mocks.readPreferredPrinter,
  savePreferredPrinter: vi.fn(),
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

function renderAppStatus({
  printers,
  scanner = zebraScanner,
  status,
  storedPrinter,
}: {
  printers: string[]
  scanner?: { product?: string } | null
  status: "connected" | "connecting" | "disconnected" | "error"
  storedPrinter: string | null
}): string {
  mocks.useQzConnection.mockReturnValue({
    connect: vi.fn(),
    printers,
    refreshPrinters: vi.fn(),
    refreshScanner: vi.fn(),
    scanner,
    status: status as never,
  })
  mocks.readPreferredPrinter.mockReturnValue(storedPrinter)

  act(() => {
    root.render(<AppStatus />)
  })
  return container.innerHTML
}

/**
 * The checklist itself lives in a Radix popover that only mounts once opened,
 * so these assertions target the always-visible summary pill — the thing an
 * operator actually glances at before scanning.
 */
describe("AppStatus", () => {
  it("reports ready when QZ is connected and the stored printer is discovered", () => {
    const html = renderAppStatus({
      printers: ["ZDesigner ZD220-203dpi ZPL"],
      status: "connected",
      storedPrinter: "ZDesigner ZD220-203dpi ZPL",
    })

    expect(html).toContain("Sistem siap")
  })

  it("reports attention needed when QZ is down and no printer is chosen", () => {
    const html = renderAppStatus({
      printers: [],
      status: "disconnected",
      storedPrinter: null,
    })

    expect(html).toContain("Perlu perhatian")
  })

  it("reports attention needed when the stored printer is no longer discovered", () => {
    const html = renderAppStatus({
      printers: ["Some Other Printer"],
      status: "connected",
      storedPrinter: "ZDesigner ZD220-203dpi ZPL",
    })

    expect(html).toContain("Perlu perhatian")
    expect(html).not.toContain("Sistem siap")
  })

  it("reports attention needed when no Zebra scanner is detected", () => {
    const html = renderAppStatus({
      printers: ["ZDesigner ZD220-203dpi ZPL"],
      scanner: null,
      status: "connected",
      storedPrinter: "ZDesigner ZD220-203dpi ZPL",
    })

    expect(html).toContain("Perlu perhatian")
    expect(html).not.toContain("Sistem siap")
  })

  it("reports still checking while QZ is connecting", () => {
    const html = renderAppStatus({
      printers: [],
      status: "connecting",
      storedPrinter: "ZDesigner ZD220-203dpi ZPL",
    })

    expect(html).toContain("Memeriksa sistem")
  })
})
