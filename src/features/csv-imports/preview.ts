import type { CsvImportRow } from "@/features/csv-imports/csv"
import {
  getCsvImportTemplate,
  type CsvImportTemplateKey,
  toCsvImportPayload,
} from "@/features/csv-imports/templates"

type DatabasePreviewRow = {
  errors: string[] | null
  row_number: number
}

export type CsvImportPreview = {
  canImport: boolean
  errorRows: number
  headers: readonly string[]
  label: string
  payload: string
  rows: Array<CsvImportRow & { errors: string[] }>
  template: CsvImportTemplateKey
  totalRows: number
  validRows: number
}

export function buildCsvImportPreview(
  templateKey: CsvImportTemplateKey,
  sourceRows: CsvImportRow[],
  databaseRows: DatabasePreviewRow[],
): CsvImportPreview {
  const databaseErrors = new Map(
    databaseRows.map((row) => [row.row_number, row.errors ?? []]),
  )
  const rows = sourceRows.map((row) => ({
    ...row,
    errors: databaseErrors.get(row.line) ?? [],
  }))
  const errorRows = rows.filter((row) => row.errors.length > 0).length
  const template = getCsvImportTemplate(templateKey)

  return {
    canImport: errorRows === 0,
    errorRows,
    headers: template.headers,
    label: template.label,
    payload: JSON.stringify(toCsvImportPayload(sourceRows)),
    rows,
    template: templateKey,
    totalRows: rows.length,
    validRows: rows.length - errorRows,
  }
}
