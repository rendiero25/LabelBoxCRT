import type { CsvImportPreview } from "@/features/csv-imports/preview"

export type CsvImportActionState = {
  error?: string
  preview?: CsvImportPreview
  success?: string
}

export const initialCsvImportActionState: CsvImportActionState = {}
