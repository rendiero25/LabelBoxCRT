import { describe, expect, it } from "vitest"

import {
  getCsvImportTemplate,
  toCsvImportPayload,
} from "@/features/csv-imports/templates"

describe("CSV import templates", () => {
  it("defines supplier columns in the published order", () => {
    expect(getCsvImportTemplate("suppliers")).toMatchObject({
      label: "Supplier",
      headers: ["supplier_code", "supplier_name"],
    })
  })

  it("adds spreadsheet line numbers to the database payload", () => {
    expect(
      toCsvImportPayload([
        {
          line: 4,
          values: { supplier_code: "10015", supplier_name: "PT Contoh" },
        },
      ]),
    ).toEqual([
      {
        line: 4,
        supplier_code: "10015",
        supplier_name: "PT Contoh",
      },
    ])
  })
})
