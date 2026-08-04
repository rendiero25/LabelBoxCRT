import { describe, expect, it } from "vitest"

import {
  describeZebraScanner,
  findZebraScanner,
  type UsbDevice,
} from "@/features/scan/zebra-scanner"

/**
 * Payload asli `usb.listDevices` dari QZ Tray di workstation ini, ditangkap
 * lewat WebSocket QZ:
 *
 *   [{"vendorId":"05e0","productId":"1200","hub":false},
 *    {"vendorId":"046d","productId":"c31c","hub":false},
 *    {"vendorId":"046d","productId":"c077","hub":false}]
 *
 * Dua hal yang dibuktikan payload ini dan sempat saya salah duga:
 * QZ melaporkan id sebagai string heksadesimal TANPA awalan 0x, dan tidak
 * menyertakan nama perangkat sama sekali.
 */
const realScanner: UsbDevice = {
  hub: false,
  productId: "1200",
  vendorId: "05e0",
}
/**
 * Printer ZD220 pada workstation yang sama. Vendor 0a5f milik Zebra
 * Technologies dipakai printer maupun scanner, dan QZ melaporkannya lebih
 * dulu daripada scanner, jadi mencocokkan vendor itu saja menamai printer
 * sebagai scanner.
 */
const zebraPrinter: UsbDevice = {
  hub: false,
  productId: "0164",
  vendorId: "0a5f",
}
const canonDevice: UsbDevice = {
  hub: false,
  productId: "183d",
  vendorId: "04a9",
}
const logitechKeyboard: UsbDevice = {
  hub: false,
  productId: "c31c",
  vendorId: "046d",
}
const logitechReceiver: UsbDevice = {
  hub: false,
  productId: "c077",
  vendorId: "046d",
}

describe("findZebraScanner", () => {
  it("finds the scanner in the real QZ device list", () => {
    expect(
      findZebraScanner([realScanner, logitechKeyboard, logitechReceiver]),
    ).toEqual(realScanner)
  })

  it("reads the vendor id as hex even without an 0x prefix", () => {
    // "05e0" as decimal would parse to 5 and never match.
    expect(findZebraScanner([{ vendorId: "05e0" }])).not.toBeNull()
  })

  it("accepts an 0x-prefixed vendor id", () => {
    expect(findZebraScanner([{ vendorId: "0x05E0" }])).not.toBeNull()
  })

  it("accepts a numeric vendor id", () => {
    expect(findZebraScanner([{ vendorId: 0x05e0 }])).not.toBeNull()
  })

  it("picks the scanner, not the Zebra printer listed before it", () => {
    expect(
      findZebraScanner([
        canonDevice,
        zebraPrinter,
        logitechKeyboard,
        logitechReceiver,
        realScanner,
      ]),
    ).toEqual(realScanner)
  })

  it("ignores a bare Zebra-vendor device because printers share that vendor", () => {
    expect(findZebraScanner([zebraPrinter])).toBeNull()
  })

  it("accepts a Zebra-vendor device that names itself a scanner", () => {
    expect(
      findZebraScanner([{ product: "Zebra DS2278 Scanner", vendorId: "0a5f" }]),
    ).not.toBeNull()
  })

  it("ignores devices from other vendors", () => {
    expect(findZebraScanner([logitechKeyboard, logitechReceiver])).toBeNull()
  })

  it("ignores USB hubs even from a matching vendor", () => {
    expect(findZebraScanner([{ hub: true, vendorId: "05e0" }])).toBeNull()
  })

  it("returns null for an empty list", () => {
    expect(findZebraScanner([])).toBeNull()
  })

  it("prefers a DS22 when the list happens to carry product text", () => {
    const found = findZebraScanner([
      { product: "Zebra Generic", vendorId: "05e0" },
      { product: "Symbol DS2208", vendorId: "05e0" },
    ])
    expect(found?.product).toBe("Symbol DS2208")
  })

  it("survives malformed entries without throwing", () => {
    expect(() =>
      findZebraScanner([
        null as unknown as UsbDevice,
        { vendorId: {} as unknown as string },
        realScanner,
      ]),
    ).not.toThrow()
    expect(
      findZebraScanner([null as unknown as UsbDevice, realScanner]),
    ).toEqual(realScanner)
  })
})

describe("describeZebraScanner", () => {
  it("names the device by its ids when QZ reports no text", () => {
    // usb.listDevices never carries manufacturer or product strings.
    expect(describeZebraScanner(realScanner)).toBe("Zebra 05e0:1200")
  })

  it("prefers product text when a source provides it", () => {
    expect(
      describeZebraScanner({ product: "Symbol Bar Code Scanner::EA" }),
    ).toBe("Symbol Bar Code Scanner")
  })

  it("falls back to the manufacturer when there is no product text", () => {
    expect(describeZebraScanner({ manufacturer: "Zebra Technologies" })).toBe(
      "Zebra Technologies",
    )
  })

  it("falls back to a generic label when nothing identifies the device", () => {
    expect(describeZebraScanner({})).toBe("Scanner Zebra")
  })
})
