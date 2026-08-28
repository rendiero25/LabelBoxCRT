import ExcelJS from "exceljs"

/**
 * Satu baris Schedule Delivery hasil baca file. Qty dibawa sebagai string
 * karena RPC-nya menerima jsonb dan memvalidasi bentuk angkanya sendiri:
 * mengubahnya jadi number di sini berarti pembulatan diam-diam pada nilai
 * seperti 5000.4 yang seharusnya ditolak.
 */
export type ScheduleRowDraft = {
  /** Null kalau dokumennya tidak berkolom Customer. */
  customer: string | null
  productSize: string
  qty: string
}

export type ScheduleParseErrorCode =
  | "SCHEDULE_FILE_UNREADABLE"
  | "SCHEDULE_HEADER_NOT_FOUND"
  | "SCHEDULE_NO_ROWS"
  | "SCHEDULE_NO_SHEET_ROWS"
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

/**
 * DO Report menamai kolom ukurannya "Item No"; dokumen jadwal lama memakai
 * "Part No". Keduanya menunjuk hal yang sama.
 */
function isProductSizeHeader(key: string): boolean {
  const isPart = key.includes("part")
  const isItem = key.includes("item")
  return (isPart || isItem) && (key.includes("no") || key.includes("number"))
}

function isQtyHeader(key: string): boolean {
  return (
    key.includes("qty") || key.includes("quantity") || key.includes("jumlah")
  )
}

/**
 * Dicocokkan persis, bukan lewat `includes`. DO Report memuat "Customer PONo"
 * dan "Customer No" sebelum kolom "Customer" yang sebenarnya, dan pencocokan
 * longgar akan mengambil nomor PO sebagai nama customer.
 */
function isCustomerHeader(key: string): boolean {
  return key === "customer" || key === "customername" || key === "pelanggan"
}

function isDivisionHeader(key: string): boolean {
  return key.startsWith("divisi") || key.startsWith("division")
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
 * Nol dikembalikan sebagai "0", bukan null: bedanya penting. Qty nol berarti
 * baris itu tidak jadi dikirim -- lazim di DO Report -- dan tidak ada yang
 * perlu diverifikasi. Qty yang tidak terbaca berarti dokumennya bermasalah.
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
  return trimmed === "" ? "0" : trimmed
}

type HeaderPosition = {
  customerColumn: number
  divisionColumn: number
  headerRow: number
  productSizeColumn: number
  qtyColumn: number
}

function findHeader(sheet: ExcelJS.Worksheet): HeaderPosition | null {
  const lastRow = Math.min(sheet.rowCount, HEADER_SEARCH_DEPTH)

  for (let rowNumber = 1; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    let customerColumn = 0
    let divisionColumn = 0
    let productSizeColumn = 0
    let qtyColumn = 0

    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const key = headerKey(cellText(cell.value))
      if (key === "") return
      if (productSizeColumn === 0 && isProductSizeHeader(key))
        productSizeColumn = columnNumber
      if (qtyColumn === 0 && isQtyHeader(key)) qtyColumn = columnNumber
      if (customerColumn === 0 && isCustomerHeader(key))
        customerColumn = columnNumber
      if (divisionColumn === 0 && isDivisionHeader(key))
        divisionColumn = columnNumber
    })

    if (productSizeColumn > 0 && qtyColumn > 0) {
      return {
        customerColumn,
        divisionColumn,
        headerRow: rowNumber,
        productSizeColumn,
        qtyColumn,
      }
    }
  }

  return null
}

/**
 * Membaca Schedule Delivery dari satu workbook Excel.
 *
 * Dokumen yang dipakai seterusnya adalah DO Report: satu file memuat seluruh
 * divisi dan seluruh customer untuk rentang tanggalnya. Kalau ada kolom Divisi,
 * **hanya baris divisi sheet yang diambil** -- tube dan kabel bukan urusan
 * halaman ini dan tidak akan pernah punya MPQ, jadi membiarkannya masuk berarti
 * tiap session macet dengan baris yang tidak mungkin discan. Dokumen tanpa
 * kolom Divisi dibaca seluruhnya, seperti dulu.
 *
 * Baris tanpa ukuran dilewati diam-diam: dokumen jadwal kerap menyisakan baris
 * kosong pemisah, baris subtotal, dan catatan kaki, dan tidak satu pun dari itu
 * kiriman. Baris ber-Qty nol juga dilewati -- barangnya tidak jadi dikirim.
 *
 * Sebaliknya, baris yang punya ukuran tetapi Qty-nya tidak terbaca
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
  let sawOtherDivision = false

  for (
    let rowNumber = header.headerRow + 1;
    rowNumber <= sheet.rowCount;
    rowNumber += 1
  ) {
    const row = sheet.getRow(rowNumber)
    const productSize = cellText(row.getCell(header.productSizeColumn).value)
      .replace(/\s+/g, " ")
      .trim()
    if (productSize === "") continue

    // Divisi disaring lebih dulu, sebelum Qty dibaca: baris tube yang Qty-nya
    // kosong tidak boleh menggagalkan file jadwal sheet.
    if (header.divisionColumn > 0) {
      const division = cellText(row.getCell(header.divisionColumn).value)
      if (!division.toLowerCase().includes("sheet")) {
        sawOtherDivision = true
        continue
      }
    }

    const qty = qtyDigits(cellText(row.getCell(header.qtyColumn).value))
    if (qty === null) {
      return {
        ok: false,
        code: "SCHEDULE_QTY_INVALID",
        detail: `baris ${rowNumber}`,
      }
    }

    if (qty === "0") continue

    const customer =
      header.customerColumn > 0
        ? cellText(row.getCell(header.customerColumn).value)
            .replace(/\s+/g, " ")
            .trim()
        : ""

    rows.push({ customer: customer === "" ? null : customer, productSize, qty })
  }

  if (rows.length === 0) {
    // Dibedakan dari file yang memang kosong: file penuh baris tube saja bukan
    // dokumen rusak, cuma bukan jadwal sheet -- dan pesannya harus mengatakan
    // itu, bukan menyuruh operator memeriksa judul kolomnya.
    return {
      ok: false,
      code: sawOtherDivision ? "SCHEDULE_NO_SHEET_ROWS" : "SCHEDULE_NO_ROWS",
    }
  }

  return { ok: true, rows }
}
