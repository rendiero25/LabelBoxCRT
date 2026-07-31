import { describe, expect, it } from "vitest"

import { findZebraScanner, type HidDevice } from "@/features/scan/zebra-scanner"

const ds22: HidDevice = {
  manufacturer: "Symbol Technologies, Inc, 2008",
  product: "Symbol Bar Code Scanner DS2208",
  productId: 4864,
  vendorId: 1504,
}

/**
 * Descriptor asli unit DS2208 di workstation ini, dibaca dari Windows:
 * VID_05E0 PID_1200, BusReportedDeviceDesc "Symbol Bar Code Scanner::EA".
 * Namanya tidak memuat "DS22" sama sekali, jadi kasus ini membuktikan
 * pencocokan vendor id yang menanggung deteksi, bukan pencocokan teks.
 */
const realDs2208: HidDevice = {
  product: "Symbol Bar Code Scanner::EA",
  productId: 0x1200,
  vendorId: 0x05e0,
}

describe("findZebraScanner", () => {
  it("matches the real DS2208 descriptor from this workstation", () => {
    expect(findZebraScanner([realDs2208])).not.toBeNull()
  })

  it("matches a Zebra scanner by its numeric vendor id", () => {
    expect(findZebraScanner([ds22])?.product).toBe(
      "Symbol Bar Code Scanner DS2208",
    )
  })

  it("accepts a vendor id reported as a hex string", () => {
    expect(findZebraScanner([{ ...ds22, vendorId: "0x05E0" }])).not.toBeNull()
  })

  it("accepts a vendor id reported as a decimal string", () => {
    expect(findZebraScanner([{ ...ds22, vendorId: "1504" }])).not.toBeNull()
  })

  it("matches on the product text when the vendor id is missing", () => {
    expect(
      findZebraScanner([{ product: "Zebra DS22 Scanner" }]),
    ).not.toBeNull()
  })

  it("matches on the manufacturer text when the product is missing", () => {
    expect(findZebraScanner([{ manufacturer: "Zebra Technologies" }])).not.toBeNull()
  })

  it("ignores devices from other vendors", () => {
    expect(
      findZebraScanner([
        { manufacturer: "Logitech", product: "USB Keyboard", vendorId: 1133 },
      ]),
    ).toBeNull()
  })

  it("returns null for an empty device list", () => {
    expect(findZebraScanner([])).toBeNull()
  })

  it("prefers a DS22 model over another Zebra device", () => {
    const found = findZebraScanner([
      { product: "Zebra Generic HID", vendorId: 1504 },
      ds22,
    ])
    expect(found?.product).toBe("Symbol Bar Code Scanner DS2208")
  })

  it("still reports a Zebra device that is not a DS22", () => {
    expect(
      findZebraScanner([{ product: "Zebra LI4278", vendorId: 1504 }])?.product,
    ).toBe("Zebra LI4278")
  })

  it("survives malformed entries without throwing", () => {
    expect(() =>
      findZebraScanner([
        null as unknown as HidDevice,
        { vendorId: {} as unknown as number },
        ds22,
      ]),
    ).not.toThrow()
    expect(
      findZebraScanner([null as unknown as HidDevice, ds22]),
    ).not.toBeNull()
  })
})

describe("describeZebraScanner", () => {
  it("prefers the product text for the status detail", async () => {
    const { describeZebraScanner } = await import(
      "@/features/scan/zebra-scanner"
    )
    expect(describeZebraScanner(ds22)).toBe("Symbol Bar Code Scanner DS2208")
  })

  it("falls back to the manufacturer when no product text exists", async () => {
    const { describeZebraScanner } = await import(
      "@/features/scan/zebra-scanner"
    )
    expect(describeZebraScanner({ manufacturer: "Zebra Technologies" })).toBe(
      "Zebra Technologies",
    )
  })

  it("falls back to a generic label when the device is nameless", async () => {
    const { describeZebraScanner } = await import(
      "@/features/scan/zebra-scanner"
    )
    expect(describeZebraScanner({ vendorId: 1504 })).toBe("Scanner Zebra")
  })

  it("drops the interface suffix Windows reports on the real unit", async () => {
    const { describeZebraScanner } = await import(
      "@/features/scan/zebra-scanner"
    )
    expect(describeZebraScanner(realDs2208)).toBe("Symbol Bar Code Scanner")
  })
})
