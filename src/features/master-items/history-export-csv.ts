import type {
  HistoryCell,
  HistorySection,
} from "@/features/master-items/history-export"
import type { MasterItemHistoryRow } from "@/features/master-items/history"
import { buildHistorySections } from "@/features/master-items/history-export"

/**
 * Riwayat Master Item sebagai CSV.
 *
 * CSV hanya punya satu tabel per berkas, sedangkan riwayatnya empat tingkat.
 * Menumpuk keempatnya dalam satu berkas dengan baris pemisah akan membuat
 * berkasnya tidak bisa dibaca satu pun pengurai CSV; jadi tiap tingkat diunduh
 * sebagai berkasnya sendiri dan admin memilih tingkat mana yang dia butuhkan.
 *
 * Waktu ditulis ISO 8601, bukan format lokal: CSV dibaca mesin (Power BI,
 * Access, skrip), dan "12-08-2026" tidak bisa dibedakan dari "08-12-2026".
 */

const DELIMITER = ","
const NEWLINE = "\r\n"

/** BOM supaya Excel di Windows membaca berkasnya sebagai UTF-8, bukan ANSI. */
export const CSV_BOM = "﻿"

/**
 * Sel teks yang diawali `= + - @` dibaca Excel sebagai rumus, dan sebagian
 * isinya berasal dari hasil scan di lapangan. Tanda kutip di depan membuatnya
 * tetap teks tanpa mengubah karakter aslinya.
 */
function guardFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

function serialize(value: HistoryCell, kind: string): string {
  if (value === null) return ""
  if (value instanceof Date) {
    return kind === "date"
      ? value.toISOString().slice(0, 10)
      : value.toISOString()
  }
  if (typeof value === "number") return String(value)
  return guardFormula(value)
}

function escape(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function sectionToCsv(section: HistorySection): string {
  const lines = [
    section.columns.map((column) => escape(column.header)).join(DELIMITER),
    ...section.rows.map((row) =>
      section.columns
        .map((column) =>
          escape(serialize(row[column.key] ?? null, column.kind)),
        )
        .join(DELIMITER),
    ),
  ]

  return CSV_BOM + lines.join(NEWLINE) + NEWLINE
}

export function buildMasterItemHistoryCsv(
  rows: MasterItemHistoryRow[],
  sectionKey: string,
): string | null {
  const section = buildHistorySections(rows).find(
    (candidate) => candidate.key === sectionKey,
  )

  return section ? sectionToCsv(section) : null
}
