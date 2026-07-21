import { describe, expect, it } from "vitest"

import { buildCsvImportPreview } from "@/features/csv-imports/preview"

describe("buildCsvImportPreview", () => {
  it("groups database validation errors by source row", () => {
    expect(
      buildCsvImportPreview(
        "suppliers",
        [
          {
            line: 2,
            values: { supplier_code: "10015", supplier_name: "PT Contoh" },
          },
          {
            line: 3,
            values: { supplier_code: "10015", supplier_name: "Duplikat" },
          },
        ],
        [{ row_number: 3, errors: ["Kode supplier sudah digunakan."] }],
      ),
    ).toMatchObject({
      canImport: false,
      validRows: 1,
      errorRows: 1,
      rows: [
        { line: 2, errors: [] },
        { line: 3, errors: ["Kode supplier sudah digunakan."] },
      ],
    })
  })
})
