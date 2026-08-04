import {
  LABEL_FONT_BOLD,
  LABEL_FONT_REGULAR,
  labelFontPath,
} from "@/lib/label/font"
import type { FormattedLabelFields } from "@/lib/label/formatter"

/**
 * ZPL template v4 for Zebra ZD220 (203 dpi), media 75 mm x 55 mm landscape
 * with 3 mm gap, thermal-transfer wax ribbon.
 *
 * v5 memakai font TrueType Outfit yang ditanam ke memori printer, sama dengan
 * font aplikasi, menggantikan font resident ^A0. Lebar hurufnya tidak seragam
 * sehingga pemotongan teks diserahkan ke ^FB.
 *
 * v4 mengganti tata letak tumpuk v3 dengan tabel bergaris: kop nama perusahaan
 * di atas, lalu delapan baris "label | nilai", dan QR menempel di kanan atas
 * mengapit tiga baris pertama. Media berubah dari potret 55x75 menjadi
 * mendatar 75x55, jadi seluruh geometrinya dihitung ulang.
 */
export const TEMPLATE_VERSION = "v5"

const DOTS_PER_MM = 8
export const LABEL_WIDTH_DOTS = 75 * DOTS_PER_MM // 600
export const LABEL_LENGTH_DOTS = 55 * DOTS_PER_MM // 440

const COMPANY_NAME = "PT. CRT KABELITA"

/** Garis luar dan garis pemisah; 2 dot sudah pekat pada 203 dpi. */
const BORDER_DOTS = 2
const FRAME_X = 8
const FRAME_Y = 8
const FRAME_WIDTH = LABEL_WIDTH_DOTS - FRAME_X * 2 // 584
const FRAME_HEIGHT = LABEL_LENGTH_DOTS - FRAME_Y * 2 // 424

const HEADER_HEIGHT = 60
const ROWS_TOP = FRAME_Y + HEADER_HEIGHT // 68
const ROW_COUNT = 8
const ROW_HEIGHT = 44 // 8 x 44 = 352; 68 + 352 = 420, sisa 12 dot di bawah
const ROWS_BOTTOM = ROWS_TOP + ROW_COUNT * ROW_HEIGHT

/**
 * Kolom kiri memuat nama field, kolom kanan nilainya. Lebar kolom kiri diambil
 * dari nama terpanjang ("Delivery Date"), lebar kolom kanan dari nilai
 * terpanjang yang nyata, yaitu Lot No 26 karakter.
 */
const LABEL_COLUMN_X = FRAME_X + 14
const VALUE_DIVIDER_X = 196
const VALUE_COLUMN_X = VALUE_DIVIDER_X + 14

/**
 * QR berdiri di kanan atas sebagai satu blok utuh: kolomnya dimulai dari tepi
 * atas bingkai, bukan dari bawah kop, dan garis mendatar kop maupun tiga baris
 * pertama berhenti di kolom ini. Tanpa itu ada garis melintas di belakang QR.
 *
 * Payload tujuh field (~60 karakter byte mode) butuh QR versi 4, yaitu 33
 * modul; magnifikasi 4 memberi 132 dot, muat di kolom selebar 156 dot dan
 * setinggi kop + tiga baris (192 dot).
 */
const QR_MAGNIFICATION = 4
const QR_MODULES = 33
const QR_SIZE = QR_MODULES * QR_MAGNIFICATION
const QR_COLUMN_X = 436
const QR_ROWS = 3
const QR_COLUMN_BOTTOM = ROWS_TOP + QR_ROWS * ROW_HEIGHT
const QR_X =
  QR_COLUMN_X + Math.floor((FRAME_X + FRAME_WIDTH - QR_COLUMN_X - QR_SIZE) / 2)
const QR_Y = FRAME_Y + Math.floor((QR_COLUMN_BOTTOM - FRAME_Y - QR_SIZE) / 2)

const COMPANY_FONT = { height: 44, width: 25 }
const LABEL_FONT = { height: 22, width: 12 }
const VALUE_FONT = { height: 26, width: 14 }
/** Part No dicetak paling tinggi; itu field yang dicari operator lebih dulu. */
const PART_NO_FONT = { height: 30, width: 12 }

type ZplFont = { height: number; width: number }

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

type LabelRow = {
  font?: ZplFont
  label: string
  value: string
}

/**
 * TrueType punya lebar huruf yang berbeda-beda, jadi muat atau tidaknya tidak
 * bisa dihitung dari jumlah karakter seperti pada font resident. ^FB menyerahkan
 * pemotongan kepada printer: teks dibatasi selebar kolomnya, satu baris saja.
 */
function textCommand(
  x: number,
  y: number,
  font: ZplFont,
  blockWidth: number,
  text: string,
  bold: boolean,
): string {
  const fontPath = labelFontPath(bold ? LABEL_FONT_BOLD : LABEL_FONT_REGULAR)

  return (
    `^FO${x},${y}` +
    `^A@N,${font.height},${font.width},${fontPath}` +
    `^FB${blockWidth},1,0,L,0` +
    `^FH^FD${text}^FS`
  )
}

export function buildLabelZpl(fields: FormattedLabelFields): string {
  const rows: LabelRow[] = [
    { label: "Supplier ID", value: fields.supplierCode },
    { font: PART_NO_FONT, label: "Part No", value: fields.partNo },
    { label: "Qty/Box", value: fields.packingQty },
    { label: "Qty/Delivery", value: fields.qtyDelivery },
    { label: "Item List", value: fields.masterItemRowNo },
    { label: "Lot No", value: fields.lotNo },
    { label: "No Box", value: fields.boxNumber },
    { label: "Delivery Date", value: fields.deliveryDate },
  ]

  const commands = [
    "^XA",
    "^CI28",
    "^MTT",
    "^PW600",
    "^LL440",
    "^MNY",
    "^LH0,0",
  ]

  // Lebar garis mendatar: di wilayah QR garisnya berhenti di kolom QR, di
  // bawahnya melintang penuh sampai bingkai kanan.
  const ruleWidth = (y: number) =>
    y <= QR_COLUMN_BOTTOM ? QR_COLUMN_X - FRAME_X : FRAME_WIDTH

  commands.push(
    `^FO${FRAME_X},${FRAME_Y}^GB${FRAME_WIDTH},${FRAME_HEIGHT},${BORDER_DOTS}^FS`,
    `^FO${FRAME_X},${ROWS_TOP}^GB${ruleWidth(ROWS_TOP)},0,${BORDER_DOTS}^FS`,
    `^FO${VALUE_DIVIDER_X},${ROWS_TOP}^GB0,${ROWS_BOTTOM - ROWS_TOP},${BORDER_DOTS}^FS`,
    // Kolom QR berdiri dari tepi atas bingkai sampai akhir baris ketiga.
    `^FO${QR_COLUMN_X},${FRAME_Y}^GB0,${QR_COLUMN_BOTTOM - FRAME_Y},${BORDER_DOTS}^FS`,
  )

  const labelBlockWidth = VALUE_DIVIDER_X - LABEL_COLUMN_X - 8

  commands.push(
    textCommand(
      LABEL_COLUMN_X,
      FRAME_Y + 8,
      COMPANY_FONT,
      QR_COLUMN_X - LABEL_COLUMN_X - 14,
      escapeZplText(COMPANY_NAME),
      true,
    ),
  )

  rows.forEach((row, index) => {
    const rowTop = ROWS_TOP + index * ROW_HEIGHT
    const font = row.font ?? VALUE_FONT
    const valueRight = index < QR_ROWS ? QR_COLUMN_X : FRAME_X + FRAME_WIDTH
    const valueBlockWidth = valueRight - VALUE_COLUMN_X - 14

    // Garis pemisah antar baris; baris pertama sudah dibatasi garis kop.
    if (index > 0) {
      commands.push(
        `^FO${FRAME_X},${rowTop}^GB${ruleWidth(rowTop)},0,${BORDER_DOTS}^FS`,
      )
    }

    const labelBaseline =
      rowTop + Math.floor((ROW_HEIGHT - LABEL_FONT.height) / 2)
    const valueBaseline = rowTop + Math.floor((ROW_HEIGHT - font.height) / 2)

    commands.push(
      textCommand(
        LABEL_COLUMN_X,
        labelBaseline,
        LABEL_FONT,
        labelBlockWidth,
        escapeZplText(row.label),
        false,
      ),
      // Nilai memakai berat SemiBold: itu yang dibaca operator dari jarak
      // satu meja.
      textCommand(
        VALUE_COLUMN_X,
        valueBaseline,
        font,
        valueBlockWidth,
        escapeZplText(row.value),
        true,
      ),
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
