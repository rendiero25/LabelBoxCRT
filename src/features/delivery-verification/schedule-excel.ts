import ExcelJS from "exceljs"

/**
 * Satu baris Schedule Delivery hasil baca file. Qty dibawa sebagai string
 * karena RPC-nya menerima jsonb dan memvalidasi bentuk angkanya sendiri:
 * mengubahnya jadi number di sini berarti pembulatan diam-diam pada nilai
 * seperti 5000.4 yang seharusnya ditolak.
 */
export type ScheduleRowDraft = {
  partNo: string
  qty: string
}

export type ScheduleParseErrorCode =
  | "SCHEDULE_FILE_UNREADABLE"
  | "SCHEDULE_HEADER_NOT_FOUND"
  | "SCHEDULE_NO_ROWS"
  | "SCHEDULE_QTY_INVALID"

export type ScheduleParseResult =
  | { ok: true; rows: ScheduleRowDraft[] }
  | { ok: false; code: ScheduleParseErrorCode; detail?: string }

/**
 * Berapa baris teratas yang diperiksa mencari baris header. Dokumen jadwal
 * lazim berkop -- nama perusahaan, nomor dokumen, tanggal -- sebelum tabelnya
 * mulai, jadi header tidak bisa dipatok di baris pertama.
 */
const HEADER_SEARCH_DEPTH = 20

/**
 * Nama kolom dibandingkan setelah seluruh yang bukan huruf/angka dibuang,
 * sehingga "Part No", "PART_NO", "Part  Number", dan "part-no" jatuh ke bentuk
 * yang sama. Tanpa ini tiap variasi ejaan butuh cabangnya sendiri.
 */
function headerKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function isPartNoHeader(key: string): boolean {
  return key.includes("part") && (key.includes("no") || key.includes("number"))
}

function isQtyHeader(key: string): boolean {
  return (
    key.includes("qty") || key.includes("quantity") || key.includes("jumlah")
  )
}

/**
 * Teks satu sel. ExcelJS memberi rumus sebagai objek berisi hasil hitungnya,
 * dan rich text sebagai potongan bergaya; keduanya harus diratakan dulu atau
 * kolomnya terbaca kosong padahal di layar Excel ada isinya.
 */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  if (value instanceof Date) return value.toISOString()

  if (typeof value === "object") {
    if ("result" in value && value.result !== undefined) {
      return cellText(value.result as ExcelJS.CellValue)
    }
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) => part.text)
        .join("")
        .trim()
    }
    if ("text" in value && typeof value.text === "string") {
      return value.text.trim()
    }
  }

  return ""
}

/**
 * Qty ditulis bermacam-macam di dokumen nyata: angka Excel (5000), teks
 * ("5000"), berpemisah ribuan ("5.000" atau "5,000"), dan kadang bersatuan
 * ("5000 pcs"). Semuanya menunjuk angka yang sama, jadi yang dibaca digitnya.
 *
 * Yang tidak diterima: pecahan. Qty setengah keping tidak punya arti di
 * lapangan, dan membulatkannya diam-diam mengubah isi dokumen.
 */
function qtyDigits(raw: string): string | null {
  const text = raw.replace(/\s+/g, "").replace(/pcs$/i, "")
  if (text === "") return null

  const withoutSeparators = text.replace(/[.,](?=\d{3}\b)/g, "")
  if (!/^\d+$/.test(withoutSeparators)) return null

  const trimmed = withoutSeparators.replace(/^0+/, "")
  return trimmed === "" ? null : trimmed
}

type HeaderPosition = {
  headerRow: number
  partNoColumn: number
  qtyColumn: number
}

function findHeader(sheet: ExcelJS.Worksheet): HeaderPosition | null {
  const lastRow = Math.min(sheet.rowCount, HEADER_SEARCH_DEPTH)

  for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    let partNoColumn = 0
    let qtyColumn = 0

    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const key = headerKey(cellText(cell.value))
      if (key === "") return
      if (partNoColumn === 0 && isPartNoHeader(key)) partNoColumn = columnNumber
      if (qtyColumn === 0 && isQtyHeader(key)) qtyColumn = columnNumber
    })

    if (partNoColumn > 0 && qtyColumn > 0) {
      return { headerRow: rowNumber, partNoColumn, qtyColumn }
    }
  }

  return null
}

/**
 * Membaca Schedule Delivery dari satu workbook Excel.
 *
 * Baris tanpa Part No dilewati diam-diam: dokumen jadwal kerap menyisakan baris
 * kosong pemisah, baris subtotal, dan catatan kaki di bawah tabelnya, dan tidak
 * satu pun dari itu kiriman.
 *
 * Sebaliknya, baris yang punya Part No tetapi Qty-nya tidak terbaca
 * menggagalkan seluruh file. Melewatinya berarti kiriman hilang dari jadwal
 * tanpa ada yang tahu, dan itu baru ketahuan saat labelnya tidak punya baris
 * untuk dicocokkan.
 */
export async function parseScheduleWorkbook(
  data: ArrayBuffer,
): Promise<ScheduleParseResult> {
  const workbook = new ExcelJS.Workbook()

  try {
    await workbook.xlsx.load(data)
  } catch {
    return { ok: false, code: "SCHEDULE_FILE_UNREADABLE" }
  }

  const sheet = workbook.worksheets.find((candidate) => candidate.rowCount > 0)
  if (!sheet) return { ok: false, code: "SCHEDULE_NO_ROWS" }

  const header = findHeader(sheet)
  if (!header) return { ok: false, code: "SCHEDULE_HEADER_NOT_FOUND" }

  const rows: ScheduleRowDraft[] = []

  for (
    let rowNumber = header.headerRow + 1;
    rowNumber <= sheet.rowCount;
    rowNumber += 1
  ) {
    const row = sheet.getRow(rowNumber)
    const partNo = cellText(row.getCell(header.partNoColumn).value)
      .replace(/\s+/g, " ")
      .trim()
    if (partNo === "") continue

    const qty = qtyDigits(cellText(row.getCell(header.qtyColumn).value))
    if (qty === null) {
      return {
        ok: false,
        code: "SCHEDULE_QTY_INVALID",
        detail: `baris ${rowNumber}`,
      }
    }

    rows.push({ partNo, qty })
  }

  if (rows.length === 0) return { ok: false, code: "SCHEDULE_NO_ROWS" }

  return { ok: true, rows }
}
