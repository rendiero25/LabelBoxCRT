import { describe, expect, it } from "vitest"

import {
  formatLabelFields,
  type FinalizedLabelSnapshot,
} from "@/lib/label/formatter"

const baseSnapshot: FinalizedLabelSnapshot = {
  supplierCode: "10015",
  partNo: "PN-0001",
  partName: "Bracket Assembly",
  qty: 100,
  sequenceNo: 1,
  labelReference: "1-150526-B101",
  deliveryNumber: "DN-2026-0042",
  deliveryDate: "2026-05-15",
  boxCode: "B101",
  boxName: "Standard Box",
  qrGeneratedAt: "2026-07-24T09:15:00.000Z",
}

describe("formatLabelFields", () => {
  it("maps a normal snapshot to display-ready fields", () => {
    expect(formatLabelFields(baseSnapshot)).toEqual({
      supplierCode: "10015",
      partNo: "PN-0001",
      qty: "100",
      itemBoxReference: "1-150526-B101",
      deliveryNumber: "DN-2026-0042",
      boxName: "Standard Box",
      deliveryDate: "15-May-2026",
      qrPayload: "10015|PN-0001|100|1-150526-B101|24-07-2026",
    })
  })

  it("does not combine boxName with boxCode (BR-02)", () => {
    const result = formatLabelFields(baseSnapshot)
    expect(result.boxName).toBe("Standard Box")
    expect(result.boxName).not.toContain("B101")
  })

  it("passes labelReference through untouched as itemBoxReference", () => {
    const result = formatLabelFields({
      ...baseSnapshot,
      labelReference: "42-311225-B999",
    })
    expect(result.itemBoxReference).toBe("42-311225-B999")
  })

  it.each([
    ["01-January-2026", "2026-01-01"],
    ["09-February-2026", "2026-02-09"],
    ["15-May-2026", "2026-05-15"],
    ["01-July-2026", "2026-07-01"],
    ["31-December-2026", "2026-12-31"],
    ["29-February-2024", "2024-02-29"],
  ])("formats deliveryDate as %s for input %s", (expected, isoDate) => {
    expect(formatLabelFields({ ...baseSnapshot, deliveryDate: isoDate }).deliveryDate).toBe(
      expected,
    )
  })

  it("formats qty as a plain digit string with no thousands separator", () => {
    expect(formatLabelFields({ ...baseSnapshot, qty: 12345 }).qty).toBe("12345")
  })

  it("does not truncate a long Part No", () => {
    const longPartNo = "PN-".padEnd(65, "X")
    expect(longPartNo.length).toBeGreaterThan(60)

    const result = formatLabelFields({ ...baseSnapshot, partNo: longPartNo })
    expect(result.partNo).toBe(longPartNo)
    expect(result.partNo.length).toBe(longPartNo.length)
  })

  it("does not truncate a long Delivery Number", () => {
    const longDeliveryNumber = "DN-".padEnd(70, "9")
    expect(longDeliveryNumber.length).toBeGreaterThan(60)

    const result = formatLabelFields({
      ...baseSnapshot,
      deliveryNumber: longDeliveryNumber,
    })
    expect(result.deliveryNumber).toBe(longDeliveryNumber)
    expect(result.deliveryNumber.length).toBe(longDeliveryNumber.length)
  })

  it("preserves internal whitespace in supplierCode and boxName without trimming or re-casing", () => {
    const result = formatLabelFields({
      ...baseSnapshot,
      supplierCode: "  10015  ",
      boxName: "box   with   spaces",
    })
    expect(result.supplierCode).toBe("  10015  ")
    expect(result.boxName).toBe("box   with   spaces")
  })

  it("throws when deliveryDate is not a parseable ISO date", () => {
    expect(() =>
      formatLabelFields({ ...baseSnapshot, deliveryDate: "15-05-2026" }),
    ).toThrow()
  })

  it("builds the QR payload as five pipe-separated fields", () => {
    expect(formatLabelFields(baseSnapshot).qrPayload).toBe(
      "10015|PN-0001|100|1-150526-B101|24-07-2026",
    )
  })

  it("formats the QR date as DD-MM-YYYY from a full timestamp", () => {
    const result = formatLabelFields({
      ...baseSnapshot,
      qrGeneratedAt: "2026-12-31T23:59:59.123Z",
    })
    expect(result.qrPayload.endsWith("|31-12-2026")).toBe(true)
  })

  it("throws when qrGeneratedAt is not a parseable ISO timestamp", () => {
    expect(() =>
      formatLabelFields({ ...baseSnapshot, qrGeneratedAt: "24/07/2026" }),
    ).toThrow()
  })
})
