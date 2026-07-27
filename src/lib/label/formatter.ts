/**
 * Mirrors the row shape returned by finalize_packing_session() and the
 * print_jobs snapshot columns (flowsystem.md §4.14). partName, sequenceNo,
 * and boxCode are carried for context but are not part of the label's
 * display fields (BR-07) — labelReference already encodes the sequence.
 */
export type FinalizedLabelSnapshot = {
  supplierCode: string
  partNo: string
  partName: string
  qty: number
  sequenceNo: number
  labelReference: string
  deliveryNumber: string
  deliveryDate: string
  boxCode: string
  boxName: string
  /** ISO timestamp stamped when the print job (and its QR) was created. */
  qrGeneratedAt: string
}

export type FormattedLabelFields = {
  supplierCode: string
  partNo: string
  qty: string
  itemBoxReference: string
  deliveryNumber: string
  boxName: string
  deliveryDate: string
  qrPayload: string
}

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})/

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

function formatDeliveryDate(isoDate: string): string {
  const match = isoDatePattern.exec(isoDate)
  if (!match) {
    throw new Error(
      `formatDeliveryDate: expected an ISO date (YYYY-MM-DD), received "${isoDate}"`,
    )
  }

  const [, yearText, monthText, dayText] = match
  const monthName = monthNames[Number(monthText) - 1]
  if (!monthName) {
    throw new Error(`formatDeliveryDate: invalid month in "${isoDate}"`)
  }

  return `${dayText.padStart(2, "0")}-${monthName}-${yearText}`
}

function formatQrDate(isoTimestamp: string): string {
  const match = isoDatePattern.exec(isoTimestamp)
  if (!match) {
    throw new Error(
      `formatQrDate: expected an ISO timestamp (YYYY-MM-DD...), received "${isoTimestamp}"`,
    )
  }

  const [, yearText, monthText, dayText] = match
  return `${dayText}-${monthText}-${yearText}`
}

/**
 * Pipe-separated QR content, locked by the 2026-07-24 scan-page spec:
 * supplier code, Part No, packing qty, label reference, QR generation date.
 * The label reference already encodes {sequence}-{DDMMYY}-{box code}.
 */
function buildQrPayload(snapshot: FinalizedLabelSnapshot): string {
  return [
    snapshot.supplierCode,
    snapshot.partNo,
    String(snapshot.qty),
    snapshot.labelReference,
    formatQrDate(snapshot.qrGeneratedAt),
  ].join("|")
}

export function formatLabelFields(
  snapshot: FinalizedLabelSnapshot,
): FormattedLabelFields {
  return {
    supplierCode: snapshot.supplierCode,
    partNo: snapshot.partNo,
    qty: String(snapshot.qty),
    itemBoxReference: snapshot.labelReference,
    deliveryNumber: snapshot.deliveryNumber,
    boxName: snapshot.boxName,
    deliveryDate: formatDeliveryDate(snapshot.deliveryDate),
    qrPayload: buildQrPayload(snapshot),
  }
}
