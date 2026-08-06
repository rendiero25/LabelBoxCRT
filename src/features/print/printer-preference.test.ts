// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"

import {
  PRINTER_STORAGE_KEY,
  autoSelectPrinter,
  clearPreferredPrinter,
  printerKindFor,
  readPreferredPrinter,
  resolvePrinter,
  savePreferredPrinter,
} from "@/features/print/printer-preference"

afterEach(() => window.localStorage.clear())

// Mengirim ZPL mentah ke inkjet menghasilkan berlembar-lembar teks "^XA^CI28",
// jadi pemilahan jenis printer inilah yang menentukan label tercetak atau tidak.
describe("printerKindFor", () => {
  it.each([
    "ZDesigner ZD220-203dpi ZPL",
    "Zebra Technologies ZTC ZD220-203dpi ZPL",
    "ZD230",
  ])("feeds raw ZPL to the label printer %s", (printerName) => {
    expect(printerKindFor(printerName)).toBe("label")
  })

  it.each([
    "Canon G4010 series",
    "Canon PIXMA G4010",
    "EPSON L3110 Series",
    "HP DeskJet 2300 series",
    "Brother DCP-T720DW",
  ])("feeds HTML sheets to the paper printer %s", (printerName) => {
    expect(printerKindFor(printerName)).toBe("paper")
  })

  // Nama asing tetap diperlakukan seperti sebelum printer kertas didukung:
  // memindahkannya diam-diam ke jalur HTML akan merusak alur Zebra yang jalan.
  it("keeps an unrecognised name on the raw ZPL path", () => {
    expect(printerKindFor("Godex G500")).toBe("label")
    expect(printerKindFor("")).toBe("label")
  })

  // "Canon G4010 series" memuat "G4010"; pola printer label mengenali \bzd\d{3}\b
  // dan tidak boleh ikut menangkapnya lebih dulu.
  it("does not mistake the Canon model number for a Zebra model", () => {
    expect(printerKindFor("Canon G4010 series")).toBe("paper")
  })
})

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
    expect(
      resolvePrinter("ZDesigner ZD220-203dpi ZPL", ["Other Printer"]),
    ).toBeNull()
    expect(resolvePrinter(null, ["Other Printer"])).toBeNull()
  })
})

describe("autoSelectPrinter", () => {
  it("keeps the stored printer when it is still discovered", () => {
    expect(
      autoSelectPrinter("ZDesigner ZD220-203dpi ZPL", [
        "Canon TS3300",
        "ZDesigner ZD220-203dpi ZPL",
      ]),
    ).toBe("ZDesigner ZD220-203dpi ZPL")
  })

  // Operator tidak boleh diam-diam mencetak ke printer lain hanya karena
  // pilihannya hilang dari daftar (spec D6).
  it("refuses to substitute another printer for a missing stored one", () => {
    expect(
      autoSelectPrinter("ZDesigner ZD220-203dpi ZPL", [
        "ZDesigner ZD230-203dpi ZPL",
      ]),
    ).toBeNull()
  })

  it("picks the only label printer when nothing was stored yet", () => {
    expect(
      autoSelectPrinter(null, [
        "Canon TS3300",
        "Microsoft Print to PDF",
        "ZDesigner ZD220-203dpi ZPL",
      ]),
    ).toBe("ZDesigner ZD220-203dpi ZPL")
  })

  it("stays undecided when several label printers match", () => {
    expect(
      autoSelectPrinter(null, [
        "ZDesigner ZD220-203dpi ZPL",
        "ZDesigner ZD230-203dpi ZPL",
      ]),
    ).toBeNull()
  })

  it("uses the single discovered printer even without a label-printer name", () => {
    expect(autoSelectPrinter(null, ["Some Thermal Printer"])).toBe(
      "Some Thermal Printer",
    )
  })

  it("stays undecided when nothing is discovered", () => {
    expect(autoSelectPrinter(null, [])).toBeNull()
  })
})
