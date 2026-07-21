"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/features/auth/server"
import { parseCsvImport } from "@/features/csv-imports/csv"
import type { CsvImportActionState } from "@/features/csv-imports/form-state"
import {
  parseCsvImportPayload,
  toCsvImportSourceRows,
} from "@/features/csv-imports/payload"
import { buildCsvImportPreview } from "@/features/csv-imports/preview"
import {
  getCsvImportTemplate,
  isCsvImportTemplate,
  toCsvImportPayload,
} from "@/features/csv-imports/templates"
import { csvImportRpcErrorMessage } from "@/features/csv-imports/validation"
import { createClient } from "@/lib/supabase/server"

const maxCsvBytes = 512 * 1024

function templateFromFormData(formData: FormData) {
  const template = formData.get("template")
  return typeof template === "string" && isCsvImportTemplate(template)
    ? template
    : null
}

async function previewPayload(
  templateKey: Parameters<typeof getCsvImportTemplate>[0],
  rows: ReturnType<typeof toCsvImportSourceRows>,
) {
  const template = getCsvImportTemplate(templateKey)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("preview_csv_import", {
    p_rows: toCsvImportPayload(rows),
    p_template: template.databaseType,
  })

  if (error) return { error: csvImportRpcErrorMessage(error.message) }
  return { preview: buildCsvImportPreview(templateKey, rows, data ?? []) }
}

export async function previewCsvImportAction(
  _previousState: CsvImportActionState,
  formData: FormData,
): Promise<CsvImportActionState> {
  await requireAdmin()
  const templateKey = templateFromFormData(formData)
  const file = formData.get("file")

  if (!templateKey) return { error: "Template CSV tidak dikenali." }
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Pilih berkas CSV yang tidak kosong." }
  }
  if (file.size > maxCsvBytes) {
    return { error: "Ukuran CSV maksimal 512 KB." }
  }
  if (!file.name.toLocaleLowerCase("id-ID").endsWith(".csv")) {
    return { error: "Berkas harus berformat .csv." }
  }

  const template = getCsvImportTemplate(templateKey)
  const parsed = parseCsvImport(await file.text(), template.headers)
  if ("error" in parsed) return { error: parsed.error }

  return previewPayload(templateKey, parsed.data.rows)
}

export async function commitCsvImportAction(
  _previousState: CsvImportActionState,
  formData: FormData,
): Promise<CsvImportActionState> {
  await requireAdmin()
  const templateKey = templateFromFormData(formData)
  const rawPayload = formData.get("payload")

  if (!templateKey) return { error: "Template CSV tidak dikenali." }
  if (typeof rawPayload !== "string") return { error: "Data preview CSV tidak valid." }

  const parsedPayload = parseCsvImportPayload(rawPayload)
  if ("error" in parsedPayload) return parsedPayload

  const template = getCsvImportTemplate(templateKey)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("import_csv_master_data", {
    p_correlation_id: randomUUID(),
    p_rows: parsedPayload.data,
    p_template: template.databaseType,
  })

  if (error) {
    const refreshedPreview = await previewPayload(
      templateKey,
      toCsvImportSourceRows(parsedPayload.data),
    )
    return {
      ...refreshedPreview,
      error: csvImportRpcErrorMessage(error.message),
    }
  }

  for (const path of [
    "/admin/csv-imports",
    "/admin/suppliers",
    "/admin/products",
    "/admin/master-items",
    "/admin/product-mappings",
    "/admin/delivery-numbers",
  ]) {
    revalidatePath(path)
  }

  return { success: `${data} baris ${template.label} berhasil diimport.` }
}
