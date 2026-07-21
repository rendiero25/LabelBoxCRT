import { describe, expect, it } from "vitest"

import {
  parseCsvImportPayload,
  toCsvImportSourceRows,
} from "@/features/csv-imports/payload"

describe("parseCsvImportPayload", () => {
  it("accepts preview rows with source line numbers", () => {
    expect(
      parseCsvImportPayload(
        '[{"line":2,"supplier_code":"10015","supplier_name":"PT Contoh"}]',
      ),
    ).toEqual({
      data: [
        {
          line: 2,
          supplier_code: "10015",
          supplier_name: "PT Contoh",
        },
      ],
    })
  })

  it("rejects a payload without a valid source line", () => {
    expect(
      parseCsvImportPayload('[{"line":1,"supplier_code":"10015"}]'),
    ).toEqual({ error: "Data preview CSV tidak valid." })
  })

  it("converts validated payload back to preview source rows", () => {
    const parsed = parseCsvImportPayload(
      '[{"line":2,"supplier_code":"10015","supplier_name":"PT Contoh"}]',
    )
    if ("error" in parsed) throw new Error(parsed.error)

    expect(toCsvImportSourceRows(parsed.data)).toEqual([
      {
        line: 2,
        values: { supplier_code: "10015", supplier_name: "PT Contoh" },
      },
    ])
  })
})
