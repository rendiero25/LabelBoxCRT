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
    status: "disconnected" as const,
  })),
}))

vi.mock("@/features/print/use-qz-connection", () => ({
  useQzConnection: mocks.useQzConnection,
}))

vi.mock("@/features/print/printer-preference", () => ({
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

function renderAppStatus(): string {
  act(() => {
    root.render(<AppStatus />)
  })
  return container.innerHTML
}

describe("AppStatus", () => {
  it("shows disconnected QZ and no printer by default", () => {
    mocks.useQzConnection.mockReturnValue({
      connect: vi.fn(),
      printers: [],
      refreshPrinters: vi.fn(),
      status: "disconnected",
    })
    mocks.readPreferredPrinter.mockReturnValue(null)

    const html = renderAppStatus()

    expect(html).toContain("Aplikasi siap")
    expect(html).toContain("QZ belum terhubung")
    expect(html).toContain("Printer belum dipilih")
  })

  it("shows connected QZ and the stored printer name", () => {
    mocks.useQzConnection.mockReturnValue({
      connect: vi.fn(),
      printers: ["ZDesigner ZD220-203dpi ZPL"],
      refreshPrinters: vi.fn(),
      status: "connected" as never,
    })
    mocks.readPreferredPrinter.mockReturnValue("ZDesigner ZD220-203dpi ZPL")

    const html = renderAppStatus()

    expect(html).toContain("QZ terhubung")
    expect(html).toContain("Printer: ZDesigner ZD220-203dpi ZPL")
  })
})
