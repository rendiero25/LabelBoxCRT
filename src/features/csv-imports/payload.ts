export type CsvImportPayloadRow = {
  line: number
  [key: string]: number | string
}

export function parseCsvImportPayload(
  value: string,
): { data: CsvImportPayloadRow[] } | { error: string } {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 500) {
      return { error: "Data preview CSV tidak valid." }
    }

    const rows: CsvImportPayloadRow[] = []
    for (const row of parsed) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        return { error: "Data preview CSV tidak valid." }
      }

      const values = row as Record<string, unknown>
      if (!Number.isInteger(values.line) || (values.line as number) < 2) {
        return { error: "Data preview CSV tidak valid." }
      }
      if (
        Object.entries(values).some(
          ([key, entry]) => key !== "line" && typeof entry !== "string",
        )
      ) {
        return { error: "Data preview CSV tidak valid." }
      }

      rows.push(values as CsvImportPayloadRow)
    }

    return { data: rows }
  } catch {
    return { error: "Data preview CSV tidak valid." }
  }
}

export function toCsvImportSourceRows(rows: CsvImportPayloadRow[]) {
  return rows.map(({ line, ...values }) => ({
    line,
    values: values as Record<string, string>,
  }))
}
