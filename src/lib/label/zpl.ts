import type { FormattedLabelFields } from "@/lib/label/formatter"

/**
 * ZPL template v2 for Zebra ZD220 (203 dpi), media 55 mm x 75 mm with 3 mm
 * gap, thermal-transfer wax ribbon. Layout locked by
 * docs/superpowers/specs/2026-07-24-scan-page-consolidated-form-design.md.
 *
 * v2 tightens the seven text rows (pitch 80 -> 52 dots, fonts one step
 * smaller) so the bottom third of the label is free for the QR block. Text
 * ends at y=374; the QR occupies y=392..557 of the 600 available dots.
 */
export const TEMPLATE_VERSION = "v2"

const DOTS_PER_MM = 8
export const LABEL_WIDTH_DOTS = 55 * DOTS_PER_MM // 440
export const LABEL_LENGTH_DOTS = 75 * DOTS_PER_MM // 600

const MARGIN_DOTS = 16
const ROW_HEIGHT_DOTS = 52
const FIRST_ROW_Y = 16
const VALUE_OFFSET_Y = 22
const LABEL_FONT = "^A0N,18,18"
const VALUE_FONT = "^A0N,24,24"
const VALUE_FONT_LARGE = "^A0N,30,30"
const MAX_CHARS = 28
const MAX_CHARS_LARGE = 22
const ELLIPSIS = "..."

/**
 * Model 2 QR at magnification 5. A ~52-character byte-mode payload needs
 * version 4 (33 modules), so 33 x 5 = 165 dots wide — centred horizontally
 * and clear of the text rows above.
 */
const QR_MAGNIFICATION = 5
const QR_MODULES = 33
const QR_Y = 392
const QR_X = Math.floor((LABEL_WIDTH_DOTS - QR_MODULES * QR_MAGNIFICATION) / 2)

/**
 * ^FH hex-escape (underscore prefix). Underscore itself must be replaced
 * first so escape sequences are not double-escaped.
 */
export function escapeZplText(value: string): string {
  return value
    .replaceAll("_", "_5f")
    .replaceAll("^", "_5e")
    .replaceAll("~", "_7e")
    .replace(/[\x00-\x1f\x7f]/g, "")
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return value.slice(0, maxChars - ELLIPSIS.length) + ELLIPSIS
}

type LabelRow = {
  label: string
  value: string
  large?: boolean
}

export function buildLabelZpl(fields: FormattedLabelFields): string {
  const rows: LabelRow[] = [
    { label: "Supplier Code", value: fields.supplierCode },
    { label: "Part No", value: fields.partNo, large: true },
    { label: "Qty", value: fields.qty },
    { label: "No Urut Item", value: fields.itemBoxReference, large: true },
    { label: "Delivery Number", value: fields.deliveryNumber },
    { label: "Nama Box", value: fields.boxName },
    { label: "Tanggal Delivery", value: fields.deliveryDate },
  ]

  const commands = ["^XA", "^CI28", "^MTT", "^PW440", "^LL600", "^MNY", "^LH0,0"]

  rows.forEach((row, index) => {
    const y = FIRST_ROW_Y + index * ROW_HEIGHT_DOTS
    const font = row.large ? VALUE_FONT_LARGE : VALUE_FONT
    const maxChars = row.large ? MAX_CHARS_LARGE : MAX_CHARS
    const value = escapeZplText(truncate(row.value, maxChars))
    commands.push(
      `^FO${MARGIN_DOTS},${y}${LABEL_FONT}^FD${row.label}^FS`,
      `^FO${MARGIN_DOTS},${y + VALUE_OFFSET_Y}${font}^FH^FD${value}^FS`,
    )
  })

  // ^BQ data is prefixed with the error-correction level (M) and input mode
  // (A, auto). The prefix must not be hex-escaped; only the payload is.
  commands.push(
    `^FO${QR_X},${QR_Y}^BQN,2,${QR_MAGNIFICATION}^FH^FDMA,${escapeZplText(fields.qrPayload)}^FS`,
  )

  commands.push("^XZ")
  return commands.join("\n")
}
