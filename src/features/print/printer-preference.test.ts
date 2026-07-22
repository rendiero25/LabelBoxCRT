// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"

import {
  PRINTER_STORAGE_KEY,
  clearPreferredPrinter,
  readPreferredPrinter,
  resolvePrinter,
  savePreferredPrinter,
} from "@/features/print/printer-preference"

afterEach(() => window.localStorage.clear())

describe("printer preference", () => {
  it("round-trips the printer name through localStorage", () => {
    savePreferredPrinter("ZDesigner ZD220-203dpi ZPL")
    expect(readPreferredPrinter()).toBe("ZDesigner ZD220-203dpi ZPL")
    expect(window.localStorage.getItem(PRINTER_STORAGE_KEY)).toBe(
      "ZDesigner ZD220-203dpi ZPL",
    )
    clearPreferredPrinter()
    expect(readPreferredPrinter()).toBeNull()
  })

  it("resolves only when the stored printer is still discovered", () => {
    expect(
      resolvePrinter("ZDesigner ZD220-203dpi ZPL", [
        "Microsoft Print to PDF",
        "ZDesigner ZD220-203dpi ZPL",
      ]),
    ).toBe("ZDesigner ZD220-203dpi ZPL")
  })

  it("returns null (never a fallback) when stored printer is missing", () => {
    expect(resolvePrinter("ZDesigner ZD220-203dpi ZPL", ["Other Printer"])).toBeNull()
    expect(resolvePrinter(null, ["Other Printer"])).toBeNull()
  })
})
