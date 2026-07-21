import { describe, expect, it } from "vitest"

import { parseCsvImport } from "@/features/csv-imports/csv"

describe("parseCsvImport", () => {
  it("parses quoted values and retains spreadsheet row numbers", () => {
    expect(
      parseCsvImport(
        "supplier_code,supplier_name\r\n10015,\"PT, Contoh\"\r\n",
        ["supplier_code", "supplier_name"],
      ),
    ).toEqual({
      data: {
        rows: [
          {
            line: 2,
            values: {
              supplier_code: "10015",
              supplier_name: "PT, Contoh",
            },
          },
        ],
      },
    })
  })

  it("rejects headers outside the selected template", () => {
    expect(
      parseCsvImport("supplier_code,nama\n10015,PT Contoh", [
        "supplier_code",
        "supplier_name",
      ]),
    ).toEqual({
      error:
        "Header CSV harus persis: supplier_code, supplier_name.",
    })
  })

  it("rejects an unclosed quoted value", () => {
    expect(
      parseCsvImport(
        "supplier_code,supplier_name\n10015,\"PT Contoh",
        ["supplier_code", "supplier_name"],
      ),
    ).toEqual({ error: "Format CSV tidak valid: kutip tidak ditutup." })
  })
})
