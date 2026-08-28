#!/usr/bin/env node
/**
 * Bangun blok VALUES seed MPQ Sheet dari dokumen "List MPQ CRT" (.xlsx).
 *
 * Isi MPQ Sheet datang dari satu file Excel yang sesekali direvisi utuh, bukan
 * disunting baris per baris. Skrip ini ada supaya revisi berikutnya tidak perlu
 * disalin tangan: keluarannya ditempel ke migrasi baru, dan migrasi lama tetap
 * jadi catatan apa yang pernah berlaku.
 *
 * Kolomnya dibaca dari posisi tetap sesuai dokumen 2021: B nomor urut,
 * C "PART NO CRT" (ukuran), E "MPQ", F "UNIT". Header ada di baris 4, data
 * mulai baris 5.
 *
 * Usage: node scripts/build-mpq-seed.mjs "G:\\Downloads\\MPQ CRT 2021.xlsx"
 */
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const ExcelJS = require("exceljs")

const sourcePath = process.argv[2]
if (!sourcePath) {
  console.error('Usage: node scripts/build-mpq-seed.mjs "<file.xlsx>"')
  process.exit(1)
}

const workbook = new ExcelJS.Workbook()
await workbook.xlsx.readFile(sourcePath)
const sheet = workbook.worksheets[0]

/** Sel Excel bisa berupa rumus, rich text, atau hyperlink; ambil teksnya saja. */
function cellText(value) {
  if (value == null) return null
  if (typeof value === "object" && "result" in value) return value.result
  if (typeof value === "object" && "richText" in value) {
    return value.richText.map((part) => part.text).join("")
  }
  if (typeof value === "object" && "text" in value) return value.text
  return value
}

const HEADER_ROWS = 4

const rows = []
sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
  if (rowNumber <= HEADER_ROWS) return

  const no = cellText(row.getCell(2).value)
  const size = cellText(row.getCell(3).value)
  const mpq = cellText(row.getCell(5).value)
  const unit = cellText(row.getCell(6).value)
  if (no == null && size == null && mpq == null) return

  rows.push({
    excelRow: rowNumber,
    size: typeof size === "string" ? size.trim() : size,
    mpq,
    unit: typeof unit === "string" ? unit.trim() : unit,
  })
})

const invalid = rows.filter(
  (row) =>
    typeof row.size !== "string" ||
    row.size === "" ||
    !Number.isInteger(row.mpq) ||
    row.mpq <= 0 ||
    typeof row.unit !== "string" ||
    row.unit === "",
)

if (invalid.length) {
  console.error("Baris tidak terbaca:")
  console.error(JSON.stringify(invalid, null, 2))
  process.exit(1)
}

/**
 * Ukuran dibandingkan tanpa spasi, sama seperti `product_size_key` di database
 * dan seperti `verify_delivery_label`: dokumen menulis "L=60 MM", label menulis
 * "L=60MM", dan keduanya ukuran yang sama.
 */
const sizeKey = (size) => size.toUpperCase().replace(/\s/g, "")

const unique = new Map()
const conflicts = []
for (const row of rows) {
  const key = sizeKey(row.size)
  const seen = unique.get(key)
  if (!seen) {
    unique.set(key, row)
    continue
  }
  if (seen.mpq !== row.mpq || seen.unit !== row.unit)
    conflicts.push([seen, row])
}

// Ukuran kembar dengan MPQ berbeda tidak bisa dipilih salah satunya secara
// diam-diam: satu ukuran hanya boleh punya satu MPQ, dan yang mana yang benar
// harus ditanyakan ke dokumennya, bukan ditebak di sini.
if (conflicts.length) {
  console.error("Ukuran sama dengan MPQ berbeda:")
  console.error(JSON.stringify(conflicts, null, 2))
  process.exit(1)
}

const literal = (value) => `'${value.replace(/'/g, "''")}'`

const values = [...unique.values()]
  .map((row, index) => {
    const size = row.size.toUpperCase().replace(/\s+/g, " ")
    return `  (${index + 1}, ${literal(size)}, ${row.mpq}, ${literal(row.unit.toUpperCase())})`
  })
  .join(",\n")

console.error(
  `${rows.length} baris dokumen -> ${unique.size} ukuran unik (${rows.length - unique.size} kembar dibuang)`,
)
console.log(values)
