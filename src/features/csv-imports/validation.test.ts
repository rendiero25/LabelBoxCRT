import { describe, expect, it } from "vitest"

import { csvImportRpcErrorMessage } from "@/features/csv-imports/validation"

describe("csvImportRpcErrorMessage", () => {
  it.each([
    ["CSV_IMPORT_ADMIN_REQUIRED", "Aksi ini hanya tersedia untuk admin aktif."],
    ["CSV_IMPORT_INPUT_INVALID", "Data import CSV tidak valid."],
    ["CSV_IMPORT_TEMPLATE_INVALID", "Template CSV tidak dikenali."],
    [
      "CSV_IMPORT_PREVIEW_INVALID",
      "Data berubah atau masih memiliki error. Periksa preview lagi.",
    ],
  ])("maps %s to a safe Indonesian message", (code, expected) => {
    expect(csvImportRpcErrorMessage(code)).toBe(expected)
  })
})
