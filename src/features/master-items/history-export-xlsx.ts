import ExcelJS from "exceljs"

import type {
  HistorySection,
  MasterItemExportMeta,
} from "@/features/master-items/history-export"
import type { MasterItemHistoryRow } from "@/features/master-items/history"
import { buildHistorySections } from "@/features/master-items/history-export"

/**
 * Riwayat Master Item sebagai satu berkas Excel: satu lembar per tingkat data,
 * persis bagian yang dirakit `buildHistorySections`.
 */

const DATE_TIME_FORMAT = "dd-mm-yyyy hh:mm"
const DATE_FORMAT = "dd-mm-yyyy"

function numberFormat(kind: HistorySection["columns"][number]["kind"]) {
  if (kind === "date") return DATE_FORMAT
  if (kind === "datetime") return DATE_TIME_FORMAT
  return undefined
}

function addSheet(workbook: ExcelJS.Workbook, section: HistorySection): void {
  const sheet = workbook.addWorksheet(section.name)
  sheet.columns = section.columns.map((column) => {
    const format = numberFormat(column.kind)
    return {
      header: column.header,
      key: column.key,
      style: format ? { numFmt: format } : undefined,
      width: column.width,
    }
  })

  for (const row of section.rows) sheet.addRow(row)

  // Kepala kolom dibekukan dan diberi saringan: lembar riwayat bisa ribuan
  // baris, dan kolom tanpa nama begitu digulir sama saja dengan angka tanpa
  // keterangan.
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: "frozen", ySplit: 1 }]
  sheet.autoFilter = {
    from: { column: 1, row: 1 },
    to: { column: section.columns.length, row: 1 },
  }
}

export function buildMasterItemHistoryWorkbook(
  meta: MasterItemExportMeta,
  rows: MasterItemHistoryRow[],
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "Label Box CRT"

  const sections = buildHistorySections(rows)

  // Identitas Master Item-nya ditulis sebagai lembar sendiri, bukan hanya
  // sebagai properti berkas: properti berkas tidak terlihat saat berkasnya
  // dibuka, dicetak, atau ditempel ke berkas lain.
  addSheet(workbook, {
    columns: [
      { header: "Item Code", key: "itemCode", kind: "text", width: 16 },
      { header: "Part No", key: "partNo", kind: "text", width: 26 },
      { header: "Part Name", key: "partName", kind: "text", width: 34 },
      {
        header: "Jumlah label box",
        key: "boxCount",
        kind: "number",
        width: 17,
      },
    ],
    key: "master-item",
    name: "Master Item",
    rows: [
      {
        boxCount: rows.length,
        itemCode: meta.itemCode,
        partName: meta.partName,
        partNo: meta.partNo,
      },
    ],
  })

  for (const section of sections) addSheet(workbook, section)

  workbook.title = `Riwayat ${meta.itemCode}`
  workbook.subject = `${meta.partNo} · ${meta.partName}`

  return workbook
}
