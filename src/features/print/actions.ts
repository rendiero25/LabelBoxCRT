"use server"

import { revalidatePath } from "next/cache"

import type { PrintActionResult } from "@/features/print/form-state"
import { createClient } from "@/lib/supabase/server"

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const safeRpcMessages: Record<string, string> = {
  PRINT_JOB_FORBIDDEN: "Anda tidak berhak memproses print job ini.",
  PRINT_JOB_NOT_CLAIMABLE:
    "Print job sedang diproses di tempat lain atau sudah selesai.",
  PRINT_JOB_NOT_FOUND: "Print job tidak ditemukan.",
  PRINT_JOB_NOT_PRINTING: "Status print job tidak valid untuk penyelesaian.",
  PRINT_PAYLOAD_INVALID: "Payload label tidak valid.",
  PRINTER_NAME_REQUIRED: "Printer belum dipilih.",
}

function rpcErrorMessage(code: string): string {
  return (
    safeRpcMessages[code] ?? "Aksi print gagal. Coba lagi atau hubungi admin."
  )
}

export async function claimPrintJobAction(input: {
  printJobId: string
  zplPayload: string
}): Promise<PrintActionResult> {
  if (!uuidPattern.test(input.printJobId) || !input.zplPayload) {
    return { error: "Print job tidak valid." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("claim_print_job", {
    p_print_job_id: input.printJobId,
    p_zpl_payload: input.zplPayload,
  })

  if (error || !data?.[0]) {
    const code = error?.message ?? ""
    return { error: rpcErrorMessage(code), errorCode: code }
  }

  return {
    jobStatus: data[0].job_status,
    sessionStatus: data[0].session_status,
  }
}

export async function completePrintJobAction(input: {
  printJobId: string
  result: "sent" | "failed"
  printerName: string
  errorCode?: string
  errorMessage?: string
}): Promise<PrintActionResult> {
  if (!uuidPattern.test(input.printJobId) || !input.printerName.trim()) {
    return { error: "Print job atau printer tidak valid." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("complete_print_job", {
    p_error_code: input.errorCode,
    p_error_message_safe: input.errorMessage,
    p_print_job_id: input.printJobId,
    p_printer_name: input.printerName,
    p_result: input.result,
  })

  if (error || !data?.[0]) {
    const code = error?.message ?? ""
    return { error: rpcErrorMessage(code), errorCode: code }
  }

  revalidatePath("/scan")
  return {
    attemptNo: data[0].attempt_no,
    jobStatus: data[0].job_status,
    sessionStatus: data[0].session_status,
  }
}
