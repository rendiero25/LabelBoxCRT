import type { FormattedLabelFields } from "@/lib/label/formatter"
import {
  LABEL_DOTS_PER_MM,
  LABEL_LAYOUT,
  labelRowsFor,
  type LabelRow,
} from "@/lib/label/zpl"

/**
 * Perender label untuk printer kertas biasa, dipakai Canon G4010.
 *
 * Canon G4010 itu inkjet ber-driver GDI: ia tidak mengerti ZPL sama sekali, dan
 * ZPL yang dikirim mentah ke sana keluar sebagai halaman berisi teks "^XA^CI28"
 * apa adanya. Jalur cetaknya karena itu terpisah: label dirakit jadi HTML lalu
 * dicetak QZ Tray dalam mode pixel.
 *
 * Geometrinya diturunkan dari LABEL_LAYOUT, angka dot yang sama dengan templat
 * ZPL, dibagi 8 dot/mm. Menyalin ulang ukurannya ke sini akan membuat label
 * Zebra dan label Canon perlahan berbeda bentuk tanpa ada yang menyadari.
 */
export const HTML_TEMPLATE_VERSION = "v6-html"

const L = LABEL_LAYOUT

/** Milimeter dari dot, dipendekkan supaya HTML-nya tidak penuh angka 8.4375. */
function mm(dots: number): string {
  return `${Number((dots / LABEL_DOTS_PER_MM).toFixed(4))}mm`
}

const BORDER_MM = mm(L.borderDots)

/**
 * Font bawaan sistem, bukan Outfit yang ditanam sebagai data URL.
 *
 * Outfit yang ditanam lewat @font-face tercetak dengan glyph yang salah di
 * perender cetak QZ: huruf kecil keluar sebagai huruf beraksen (ø, ǿ, ş, ẅ),
 * yaitu tanda indeks glyph meleset dari cmap-nya. Lembar yang sama benar di
 * Chrome, jadi berkas fontnya utuh dan yang keliru perendernya.
 *
 * Bentuk hurufnya karena itu tidak sama persis dengan label Zebra. Itu harga
 * yang diambil sadar: huruf yang beda bentuk masih terbaca, huruf yang salah
 * glyph tidak. Untuk mengembalikan Outfit, labelnya harus digambar ke canvas
 * lalu dicetak sebagai gambar, bukan diserahkan ke perender teks QZ.
 */
const FONT_STACK = "Arial,Helvetica,sans-serif"

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

type Box = {
  height: number
  left: number
  top: number
  width: number
}

/**
 * Lebar rata-rata satu karakter tebal sebagai pecahan em, untuk campuran huruf
 * besar, angka, dan tanda hubung yang dipakai nilai-nilai label. Diambil agak
 * longgar: menaksir terlalu lebar hanya membuat huruf sedikit lebih kecil dari
 * perlunya, sedangkan menaksir terlalu sempit membuat teksnya terpotong.
 */
const AVERAGE_ADVANCE_EM = 0.62

/**
 * QR dicetak 5% lebih kecil dari lebar kolomnya supaya ada jarak ke garis.
 *
 * Hanya berlaku di jalur HTML. Magnifikasi ^BQ pada ZPL cuma bilangan bulat,
 * jadi memangkas 5% di sana justru menjatuhkan magnifikasi 4 ke 3 — QR-nya
 * mengecil 25%, bukan 5%.
 */
const QR_SCALE = 0.95

/**
 * Tinggi huruf yang masih memuat teksnya utuh di kolomnya.
 *
 * ^FB pada jalur ZPL memotong teks yang kepanjangan, dan potongannya tidak
 * kelihatan sampai labelnya sudah tertempel di box. Di HTML ukurannya bisa
 * dihitung lebih dulu, jadi nilai yang panjang mengecil, bukan hilang separuh.
 */
export function fitFontHeight(
  text: string,
  boxWidthDots: number,
  nominalHeightDots: number,
): number {
  if (text.length === 0) return nominalHeightDots

  const naturalWidth = text.length * AVERAGE_ADVANCE_EM * nominalHeightDots
  if (naturalWidth <= boxWidthDots) return nominalHeightDots

  return boxWidthDots / (text.length * AVERAGE_ADVANCE_EM)
}

function rule(left: number, top: number, width: number): string {
  return (
    `<div style="position:absolute;left:${mm(left)};top:${mm(top)};` +
    `width:${mm(width)};height:${BORDER_MM};background:#000"></div>`
  )
}

function verticalRule(left: number, top: number, height: number): string {
  return (
    `<div style="position:absolute;left:${mm(left)};top:${mm(top)};` +
    `width:${BORDER_MM};height:${mm(height)};background:#000"></div>`
  )
}

/**
 * Satu kotak teks. ZPL menengahkan teks dengan hitungan baseline karena tidak
 * punya flexbox; di HTML kotaknya setinggi barisnya dan isinya ditengahkan,
 * hasilnya sama tetapi tidak ikut meleset kalau tinggi hurufnya diubah.
 *
 * nowrap + overflow hidden menyamai pemotongan ^FB: teks yang kepanjangan
 * terpotong di tepi kolomnya, bukan turun ke baris kedua dan merusak barisnya.
 */
function textBox(
  box: Box,
  fontHeightDots: number,
  text: string,
  align: "center" | "left",
): string {
  const fitted = fitFontHeight(text, box.width, fontHeightDots)

  return (
    `<div style="position:absolute;left:${mm(box.left)};top:${mm(box.top)};` +
    `width:${mm(box.width)};height:${mm(box.height)};` +
    `display:flex;align-items:center;justify-content:${align === "center" ? "center" : "flex-start"};` +
    `font-size:${mm(fitted)};line-height:1;` +
    `white-space:nowrap;overflow:hidden">${escapeHtml(text)}</div>`
  )
}

/** Sama seperti ruleWidth di templat ZPL: lihat komentarnya di zpl.ts. */
function ruleWidth(y: number): number {
  return y < L.qrColumnBottom || (y > L.monthTop && y < L.monthBottom)
    ? L.qrColumnX - L.frameX
    : L.frameWidth
}

function rowMarkup(row: LabelRow, index: number): string {
  const rowTop = L.rowsTop + index * L.rowHeight
  const valueRight =
    rowTop < L.rightColumnBottom ? L.qrColumnX : L.frameX + L.frameWidth

  const parts: string[] = []
  // Baris pertama sudah dibatasi garis kop.
  if (index > 0) parts.push(rule(L.frameX, rowTop, ruleWidth(rowTop)))

  parts.push(
    textBox(
      {
        height: L.rowHeight,
        left: L.labelColumnX,
        top: rowTop,
        width: L.valueDividerX - L.labelColumnX - 8,
      },
      L.labelFont.height,
      row.label,
      "left",
    ),
    textBox(
      {
        height: L.rowHeight,
        left: L.valueColumnX,
        top: rowTop,
        width: valueRight - L.valueColumnX - 14,
      },
      row.font.height,
      row.value,
      "left",
    ),
  )

  return parts.join("")
}

/**
 * Satu label sebagai potongan HTML yang berdiri sendiri: seluruh gayanya inline
 * supaya potongan ini bisa disimpan per print job dan tetap terbaca apa adanya
 * saat rekaman cetaknya diperiksa lagi.
 *
 * QR datang jadi data URL dari pemanggil, bukan dirakit di sini: pembuatannya
 * asinkron sedangkan perakit ini harus tetap murni dan bisa diuji tanpa canvas.
 */
export function buildLabelHtml(
  fields: FormattedLabelFields,
  qrDataUrl: string,
): string {
  const parts: string[] = [
    `<div style="position:relative;box-sizing:border-box;` +
      `width:${mm(L.labelWidth)};height:${mm(L.labelHeight)};` +
      `background:#fff;color:#000;font-family:${FONT_STACK};font-weight:700;` +
      `overflow:hidden">`,
    // Bingkai luar.
    `<div style="position:absolute;box-sizing:border-box;` +
      `left:${mm(L.frameX)};top:${mm(L.frameY)};` +
      `width:${mm(L.frameWidth)};height:${mm(L.frameHeight)};` +
      `border:${BORDER_MM} solid #000"></div>`,
    rule(L.frameX, L.rowsTop, ruleWidth(L.rowsTop)),
    verticalRule(
      L.valueDividerX,
      L.rowsTop,
      L.frameY + L.frameHeight - L.rowsTop,
    ),
    verticalRule(L.qrColumnX, L.frameY, L.rightColumnBottom - L.frameY),
    textBox(
      {
        height: L.headerHeight,
        left: L.labelColumnX,
        top: L.frameY,
        width: L.qrColumnX - L.labelColumnX - 14,
      },
      L.companyFont.height,
      L.companyName,
      "left",
    ),
  ]

  labelRowsFor(fields).forEach((row, index) => {
    parts.push(rowMarkup(row, index))
  })

  // QR mengisi kolomnya sebagai bujur sangkar, ditengahkan seperti di ZPL.
  const qrSize = L.qrAvailableWidth * QR_SCALE
  const qrLeft =
    L.qrColumnX + (L.frameX + L.frameWidth - L.qrColumnX - qrSize) / 2
  const qrTop = L.frameY + (L.qrColumnBottom - L.frameY - qrSize) / 2
  parts.push(
    `<img alt="" src="${qrDataUrl}" style="position:absolute;` +
      `left:${mm(qrLeft)};top:${mm(qrTop)};` +
      `width:${mm(qrSize)};height:${mm(qrSize)};image-rendering:pixelated">`,
  )

  parts.push(
    textBox(
      {
        height: L.monthBottom - L.monthTop,
        left: L.rightTextX,
        top: L.monthTop,
        width: L.rightTextWidth,
      },
      L.monthFont.height,
      fields.deliveryMonth,
      "center",
    ),
    textBox(
      {
        height: L.rowHeight,
        left: L.rightTextX,
        top: L.monthBottom,
        width: L.rightTextWidth,
      },
      L.fifoFont.height,
      L.fifoText,
      "center",
    ),
    "</div>",
  )

  return parts.join("")
}

/**
 * Lembar stiker A4 tegak, dua kolom kali lima baris. Kisinya ditengahkan supaya
 * sisa kertas di kiri dan kanan sama lebar dan operator memotongnya lurus.
 */
export const SHEET_WIDTH_MM = 210
export const SHEET_HEIGHT_MM = 297
export const SHEET_COLUMNS = 2
export const SHEET_ROWS = 5
export const LABELS_PER_SHEET = SHEET_COLUMNS * SHEET_ROWS

const LABEL_WIDTH_MM = L.labelWidth / LABEL_DOTS_PER_MM
const LABEL_HEIGHT_MM = L.labelHeight / LABEL_DOTS_PER_MM
const SHEET_MARGIN_X_MM = (SHEET_WIDTH_MM - SHEET_COLUMNS * LABEL_WIDTH_MM) / 2
const SHEET_MARGIN_Y_MM = (SHEET_HEIGHT_MM - SHEET_ROWS * LABEL_HEIGHT_MM) / 2

/** Potong daftar label menjadi kelompok selembar; sisa terakhir dibiarkan pendek. */
export function paginateLabels<T>(labels: T[]): T[][] {
  const sheets: T[][] = []
  for (let index = 0; index < labels.length; index += LABELS_PER_SHEET) {
    sheets.push(labels.slice(index, index + LABELS_PER_SHEET))
  }
  return sheets
}

/** Satu dokumen HTML per lembar. */
export function buildLabelSheetHtml(labelHtmls: string[]): string {
  const slots = labelHtmls.map((labelHtml, index) => {
    const column = index % SHEET_COLUMNS
    const row = Math.floor(index / SHEET_COLUMNS)
    const left = SHEET_MARGIN_X_MM + column * LABEL_WIDTH_MM
    const top = SHEET_MARGIN_Y_MM + row * LABEL_HEIGHT_MM
    return (
      `<div style="position:absolute;left:${left}mm;top:${top}mm">` +
      `${labelHtml}</div>`
    )
  })

  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `*{margin:0;padding:0;box-sizing:content-box}` +
    `html,body{width:${SHEET_WIDTH_MM}mm;height:${SHEET_HEIGHT_MM}mm;background:#fff}` +
    `</style></head><body>` +
    `<div style="position:relative;width:${SHEET_WIDTH_MM}mm;height:${SHEET_HEIGHT_MM}mm">` +
    `${slots.join("")}</div></body></html>`
  )
}

/** Seluruh lembar untuk satu rombongan label, urut seperti masuknya. */
export function buildLabelSheetsHtml(labelHtmls: string[]): string[] {
  return paginateLabels(labelHtmls).map(buildLabelSheetHtml)
}
