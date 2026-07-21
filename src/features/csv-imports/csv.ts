export type CsvImportRow = {
  line: number
  values: Record<string, string>
}

type ParseResult =
  | { data: { rows: CsvImportRow[] } }
  | { error: string }

export function parseCsvImport(
  text: string,
  expectedHeaders: readonly string[],
): ParseResult {
  const records: { line: number; fields: string[] }[] = []
  const normalizedText = text.replace(/^\uFEFF/, "")
  let fields: string[] = []
  let field = ""
  let inQuotes = false
  let line = 1
  let recordLine = 1
  let hasRecordContent = false

  function pushRecord() {
    fields.push(field)
    records.push({ line: recordLine, fields })
    fields = []
    field = ""
    hasRecordContent = false
  }

  for (let index = 0; index < normalizedText.length; index += 1) {
    const character = normalizedText[index]

    if (inQuotes) {
      if (character === '"') {
        if (normalizedText[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += character
        if (character === "\n") line += 1
      }
      continue
    }

    if (character === '"') {
      if (field) return { error: "Format CSV tidak valid: kutip tidak sesuai." }
      inQuotes = true
      hasRecordContent = true
      continue
    }

    if (character === ",") {
      fields.push(field)
      field = ""
      hasRecordContent = true
      continue
    }

    if (character === "\r" || character === "\n") {
      if (character === "\r" && normalizedText[index + 1] === "\n") {
        index += 1
      }

      if (hasRecordContent || field || fields.length > 0) pushRecord()
      line += 1
      recordLine = line
      continue
    }

    field += character
    hasRecordContent = true
  }

  if (inQuotes) return { error: "Format CSV tidak valid: kutip tidak ditutup." }
  if (hasRecordContent || field || fields.length > 0) pushRecord()

  const [header, ...dataRecords] = records
  if (!header) return { error: "CSV harus memiliki satu baris header." }

  if (
    header.fields.length !== expectedHeaders.length ||
    header.fields.some((value, index) => value !== expectedHeaders[index])
  ) {
    return {
      error: `Header CSV harus persis: ${expectedHeaders.join(", ")}.`,
    }
  }

  const rows: CsvImportRow[] = []
  for (const record of dataRecords) {
    if (record.fields.length !== expectedHeaders.length) {
      return {
        error: `Baris ${record.line} harus memiliki ${expectedHeaders.length} kolom.`,
      }
    }

    rows.push({
      line: record.line,
      values: Object.fromEntries(
        expectedHeaders.map((headerName, index) => [
          headerName,
          record.fields[index],
        ]),
      ),
    })
  }

  if (rows.length === 0) return { error: "CSV tidak memiliki baris data." }
  return { data: { rows } }
}
