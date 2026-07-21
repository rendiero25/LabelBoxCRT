export function csvImportRpcErrorMessage(message: string): string {
  const messages: Record<string, string> = {
    CSV_IMPORT_ADMIN_REQUIRED: "Aksi ini hanya tersedia untuk admin aktif.",
    CSV_IMPORT_INPUT_INVALID: "Data import CSV tidak valid.",
    CSV_IMPORT_TEMPLATE_INVALID: "Template CSV tidak dikenali.",
    CSV_IMPORT_PREVIEW_INVALID:
      "Data berubah atau masih memiliki error. Periksa preview lagi.",
  }

  return messages[message] ?? "Import CSV gagal. Coba lagi atau hubungi admin."
}
