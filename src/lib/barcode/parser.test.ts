import { describe, expect, it } from "vitest"

import { BARCODE_MAX_PAYLOAD_BYTES, parseBarcodeV1 } from "@/lib/barcode/parser"

const realQrSample =
  "10015|VO-B D5.5X6.3 Pt L=205|100|M-CRT-004A-778-131225-B002/P001|13-DEC-2025"

describe("parseBarcodeV1", () => {
  it("parses documented real QR sample", () => {
    expect(parseBarcodeV1(realQrSample)).toEqual({
      ok: true,
      data: {
        parserVersion: "v1",
        supplierCode: "10015",
        sizeRaw: "VO-B D5.5X6.3 Pt L=205",
        sizeNormalized: "VO-B D5.5X6.3 Pt L=205",
        sizeLookup: "VO-B D5.5X6.3 PT L=205",
        size: {
          dimension1: 5.5,
          dimension2: 6.3,
          length: 205,
        },
        labelQuantity: 100,
        productionDate: "2025-12-13",
        labelUid: "M-CRT-004A-778-131225-B002/P001",
      },
    })
  })

  // Sample QR-002 dari scanner produksi: separator sebelum L= berupa titik dan
  // bulan tertulis campuran huruf. Dua bentuk ini menolak seluruh scan sebelum
  // parser dilonggarkan.
  it("parses production sample with dotted length separator and mixed-case month", () => {
    expect(
      parseBarcodeV1(
        "10015|VO-B D6X7 Pt.L=525|100|M-CRT-004A-675-300726-B001/P0001|30-Jul-2026",
      ),
    ).toEqual({
      ok: true,
      data: expect.objectContaining({
        size: { dimension1: 6, dimension2: 7, length: 525 },
        labelUid: "M-CRT-004A-675-300726-B001/P0001",
        productionDate: "2026-07-30",
      }),
    })
  })

  // Scanner yang sama pernah mengirim payload ini seluruhnya huruf kecil
  // dengan kapital yang tidak konsisten ("pT.l=455", "jUL"). Isinya sah, jadi
  // penolakan karena besar-kecil huruf berarti label yang benar hilang.
  it("parses a payload whose letter case is inconsistent", () => {
    expect(
      parseBarcodeV1(
        "10015|vo-b d6x7 pT.l=455|100|m-crt-004a-2584-300726-b001/p0005|30-jUL-2026",
      ),
    ).toEqual({
      ok: true,
      data: expect.objectContaining({
        size: { dimension1: 6, dimension2: 7, length: 455 },
        sizeLookup: "VO-B D6X7 PT.L=455",
        labelUid: "M-CRT-004A-2584-300726-B001/P0005",
        productionDate: "2026-07-30",
      }),
    })
  })

  it("takes lot/reference as the label UID and trims scanner padding", () => {
    const parsed = parseBarcodeV1(
      "10015|VO-B D5.5X6.3 Pt L=205|100|  M-CRT-OTHER-LOT/P002 |13-DEC-2025",
    )

    expect(parsed).toMatchObject({ ok: true })
    if (!parsed.ok) throw new Error("Expected parsed barcode")

    expect(parsed.data.labelUid).toBe("M-CRT-OTHER-LOT/P002")
  })

  // Duplicate prevention membandingkan label_uid persis apa adanya, jadi label
  // fisik yang sama harus menghasilkan UID yang sama sekalipun Caps Lock
  // membalik besar-kecil hurufnya di tengah sesi.
  it("gives one physical label the same UID whatever the keyboard case", () => {
    const upper = parseBarcodeV1(
      "10015|VO-B D6X7 Pt.L=455|100|M-CRT-004A-2584-300726-B001/P0005|30-JUL-2026",
    )
    const flipped = parseBarcodeV1(
      "10015|vo-b d6x7 pT.l=455|100|m-crt-004a-2584-300726-b001/p0005|30-jUL-2026",
    )

    expect(upper).toMatchObject({ ok: true })
    expect(flipped).toMatchObject({ ok: true })
    if (!upper.ok || !flipped.ok) throw new Error("Expected parsed barcodes")

    expect(flipped.data.labelUid).toBe(upper.data.labelUid)
  })

  it("removes only final scanner terminator and normalizes Size for lookup", () => {
    expect(
      parseBarcodeV1(
        "10015|  VO-B\u00a0Ｄ5.5Ｘ6.3   Pt   L=205  |100|lot|13-DEC-2025\r\n",
      ),
    ).toEqual({
      ok: true,
      data: expect.objectContaining({
        sizeRaw: "  VO-B\u00a0Ｄ5.5Ｘ6.3   Pt   L=205  ",
        sizeNormalized: "VO-B D5.5X6.3 Pt L=205",
        sizeLookup: "VO-B D5.5X6.3 PT L=205",
      }),
    })
  })

  it.each([
    ["missing field", "10015|VO-B D5.5X6.3 Pt L=205|100|lot"],
    ["empty supplier", "|VO-B D5.5X6.3 Pt L=205|100|lot|13-DEC-2025"],
    ["empty lot reference", "10015|VO-B D5.5X6.3 Pt L=205|100||13-DEC-2025"],
    ["malformed Size", "10015|VO-B 5.5x6.3 L205|100|lot|13-DEC-2025"],
    ["decimal quantity", "10015|VO-B D5.5X6.3 Pt L=205|1.5|lot|13-DEC-2025"],
    ["zero quantity", "10015|VO-B D5.5X6.3 Pt L=205|0|lot|13-DEC-2025"],
    ["unknown date month", "10015|VO-B D5.5X6.3 Pt L=205|100|lot|13-XXX-2025"],
    [
      "impossible production date",
      "10015|VO-B D5.5X6.3 Pt L=205|100|lot|31-APR-2025",
    ],
    ["control character", "10015|VO-B D5.5X6.3 Pt L=205|100|lot\t|13-DEC-2025"],
  ])("rejects %s", (_caseName, payload) => {
    expect(parseBarcodeV1(payload)).toEqual({
      ok: false,
      code: "BARCODE_PARSE_FAILED",
    })
  })

  it("rejects an unsupported version envelope", () => {
    expect(parseBarcodeV1(`v2|${realQrSample}`)).toEqual({
      ok: false,
      code: "BARCODE_UNSUPPORTED_VERSION",
    })
  })

  it("rejects an unsupported JSON envelope", () => {
    expect(parseBarcodeV1(JSON.stringify({ payload: realQrSample }))).toEqual({
      ok: false,
      code: "BARCODE_UNSUPPORTED_ENVELOPE",
    })
  })

  it("rejects a payload longer than provisional defensive maximum", () => {
    expect(parseBarcodeV1("A".repeat(BARCODE_MAX_PAYLOAD_BYTES + 1))).toEqual({
      ok: false,
      code: "BARCODE_PAYLOAD_TOO_LONG",
    })
  })
})
