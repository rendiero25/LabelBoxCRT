/**
 * Provisional defensive byte cap, not an approved production QR length.
 * Reduce it after the required real QR samples establish a contract limit.
 */
export const BARCODE_MAX_PAYLOAD_BYTES = 2_048

export type ParsedBarcodeV1Draft = {
  parserVersion: "v1"
  supplierCode: string
  sizeRaw: string
  sizeNormalized: string
  sizeLookup: string
  size: {
    dimension1: number
    dimension2: number
    length: number
  }
  labelQuantity: number
  productionDate: string
  labelUid: null
}

export type BarcodeParseErrorCode =
  | "BARCODE_PARSE_FAILED"
  | "BARCODE_PAYLOAD_TOO_LONG"
  | "BARCODE_UNSUPPORTED_VERSION"
  | "BARCODE_UNSUPPORTED_ENVELOPE"

export type BarcodeParseResult =
  | { ok: true; data: ParsedBarcodeV1Draft }
  | { ok: false; code: BarcodeParseErrorCode }

const controlCharacterPattern = /[\p{Cc}]/u
const versionEnvelopePattern = /^v\d+(?:[|:])/i
const quantityPattern = /^[0-9]+$/
const sizePattern =
  /^(?:.+\s+)?D([0-9]+(?:\.[0-9]+)?)X([0-9]+(?:\.[0-9]+)?)\s+.+\s+L=([0-9]+(?:\.[0-9]+)?)$/
const productionDatePattern =
  /^(\d{2})-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-(\d{4})$/

const monthNumbers: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
}

function hasPayloadWithinProvisionalLimit(payload: string): boolean {
  return (
    new TextEncoder().encode(payload).byteLength <= BARCODE_MAX_PAYLOAD_BYTES
  )
}

function removeFinalScannerTerminator(payload: string): string {
  if (payload.endsWith("\r\n")) return payload.slice(0, -2)
  if (payload.endsWith("\r") || payload.endsWith("\n")) {
    return payload.slice(0, -1)
  }

  return payload
}

export function normalizeBarcodeSize(sizeRaw: string): string {
  return sizeRaw.normalize("NFKC").trim().replace(/\s+/gu, " ")
}

function parsePositiveDimension(value: string): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseProductionDate(value: string): string | null {
  const match = productionDatePattern.exec(value)
  if (!match) return null

  const [, dayText, monthText, yearText] = match
  const day = Number(dayText)
  const month = monthNumbers[monthText]
  const year = Number(yearText)

  if (!month || !Number.isInteger(day) || year < 1) return null

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1]

  if (!daysInMonth || day < 1 || day > daysInMonth) return null

  return `${yearText}-${String(month).padStart(2, "0")}-${dayText}`
}

function failed(
  code: BarcodeParseErrorCode = "BARCODE_PARSE_FAILED",
): BarcodeParseResult {
  return { ok: false, code }
}

export function parseBarcodeV1(payload: unknown): BarcodeParseResult {
  if (typeof payload !== "string") return failed()

  const rawPayload = removeFinalScannerTerminator(payload)
  if (!rawPayload || !hasPayloadWithinProvisionalLimit(rawPayload)) {
    return rawPayload ? failed("BARCODE_PAYLOAD_TOO_LONG") : failed()
  }
  if (controlCharacterPattern.test(rawPayload)) return failed()
  if (versionEnvelopePattern.test(rawPayload)) {
    return failed("BARCODE_UNSUPPORTED_VERSION")
  }
  if (rawPayload.startsWith("{") || rawPayload.startsWith("[")) {
    return failed("BARCODE_UNSUPPORTED_ENVELOPE")
  }

  const fields = rawPayload.split("|")
  if (fields.length !== 5) return failed()

  const [
    supplierCode,
    sizeRaw,
    quantityRaw,
    ignoredLotReference,
    productionDateRaw,
  ] = fields
  if (
    !supplierCode ||
    !sizeRaw ||
    !quantityRaw ||
    !ignoredLotReference ||
    !productionDateRaw ||
    !supplierCode.trim() ||
    !ignoredLotReference.trim()
  ) {
    return failed()
  }

  const sizeNormalized = normalizeBarcodeSize(sizeRaw)
  const sizeMatch = sizePattern.exec(sizeNormalized)
  if (!sizeMatch) return failed()

  const [, dimension1Raw, dimension2Raw, lengthRaw] = sizeMatch
  const dimension1 = parsePositiveDimension(dimension1Raw)
  const dimension2 = parsePositiveDimension(dimension2Raw)
  const length = parsePositiveDimension(lengthRaw)
  if (dimension1 === null || dimension2 === null || length === null)
    return failed()

  if (!quantityPattern.test(quantityRaw)) return failed()
  const labelQuantity = Number(quantityRaw)
  if (!Number.isSafeInteger(labelQuantity) || labelQuantity <= 0)
    return failed()

  const productionDate = parseProductionDate(productionDateRaw)
  if (!productionDate) return failed()

  return {
    ok: true,
    data: {
      parserVersion: "v1",
      supplierCode,
      sizeRaw,
      sizeNormalized,
      sizeLookup: sizeNormalized.toUpperCase(),
      size: { dimension1, dimension2, length },
      labelQuantity,
      productionDate,
      labelUid: null,
    },
  }
}
