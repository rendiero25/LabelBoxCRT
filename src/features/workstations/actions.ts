"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

import { requireAdmin, requireOperator } from "@/features/auth/server"
import {
  initialWorkstationActionState,
  type WorkstationActionState,
} from "@/features/workstations/form-state"
import { workstationDeviceCookieName } from "@/features/workstations/token"
import {
  parseDisableReason,
  parseEnrollmentCode,
  parseRegisterWorkstationInput,
} from "@/features/workstations/validation"
import { createClient } from "@/lib/supabase/server"

function rpcErrorMessage(message: string): string {
  const messages: Record<string, string> = {
    WORKSTATION_ADMIN_REQUIRED: "Aksi ini hanya tersedia untuk admin aktif.",
    WORKSTATION_ALREADY_ENROLLED:
      "Workstation sudah terhubung ke browser lain.",
    WORKSTATION_CODE_EXISTS: "Kode workstation sudah digunakan.",
    WORKSTATION_DISABLE_REASON_REQUIRED:
      "Alasan menonaktifkan workstation wajib diisi.",
    WORKSTATION_ENROLLMENT_INVALID:
      "Kode enrollment salah, sudah digunakan, atau kedaluwarsa.",
    WORKSTATION_INPUT_INVALID: "Data workstation tidak valid.",
    WORKSTATION_NOT_ASSIGNED:
      "Operator ini belum ditugaskan ke workstation tersebut.",
    WORKSTATION_NOT_ENROLLED:
      "Workstation belum menyelesaikan enrollment browser.",
    WORKSTATION_NOT_FOUND_OR_DISABLED:
      "Workstation tidak ditemukan atau sudah dinonaktifkan.",
    WORKSTATION_NOT_PENDING: "Workstation tidak lagi menunggu persetujuan.",
    WORKSTATION_OPERATOR_INVALID:
      "Operator yang dipilih tidak aktif atau tidak valid.",
    WORKSTATION_OPERATOR_REQUIRED:
      "Hanya operator aktif yang dapat enrollment.",
  }

  return (
    messages[message] ?? "Aksi workstation gagal. Coba lagi atau hubungi admin."
  )
}

export async function registerWorkstationAction(
  _previousState: WorkstationActionState,
  formData: FormData,
): Promise<WorkstationActionState> {
  await requireAdmin()

  const parsed = parseRegisterWorkstationInput(formData)
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("register_workstation", {
    p_workstation_code: parsed.data.workstationCode,
    p_name: parsed.data.name,
    p_printer_name: parsed.data.printerName,
    p_printer_model: parsed.data.printerModel,
    p_scanner_model: parsed.data.scannerModel,
    p_operator_id: parsed.data.operatorId,
  })

  if (error || !data?.[0]) {
    return { error: rpcErrorMessage(error?.message ?? "") }
  }

  revalidatePath("/admin/workstations")

  return {
    success:
      "Workstation pending dibuat. Berikan kode sekali-pakai ke operator perangkat ini.",
    enrollmentCode: data[0].enrollment_code,
    enrollmentExpiresAt: data[0].enrollment_expires_at,
  }
}

export async function approveWorkstationAction(
  _previousState: WorkstationActionState,
  formData: FormData,
): Promise<WorkstationActionState> {
  await requireAdmin()
  const workstationId = formData.get("workstationId")

  if (typeof workstationId !== "string" || !workstationId) {
    return { error: "Workstation tidak valid." }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("approve_workstation", {
    p_workstation_id: workstationId,
  })

  if (error) return { error: rpcErrorMessage(error.message) }

  revalidatePath("/admin/workstations")
  return { success: "Workstation disetujui." }
}

export async function disableWorkstationAction(
  _previousState: WorkstationActionState,
  formData: FormData,
): Promise<WorkstationActionState> {
  await requireAdmin()
  const parsed = parseDisableReason(formData)
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("disable_workstation", {
    p_workstation_id: parsed.data.workstationId,
    p_reason: parsed.data.reason,
  })

  if (error) return { error: rpcErrorMessage(error.message) }

  revalidatePath("/admin/workstations")
  return { success: "Workstation dinonaktifkan; token perangkat dicabut." }
}

export async function enrollWorkstationAction(
  _previousState: WorkstationActionState,
  formData: FormData,
): Promise<WorkstationActionState> {
  await requireOperator()
  const parsed = parseEnrollmentCode(formData)
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("enroll_workstation", {
    p_enrollment_code: parsed.data.enrollmentCode,
  })

  if (error || !data?.[0]) {
    return { error: rpcErrorMessage(error?.message ?? "") }
  }

  const cookieStore = await cookies()
  cookieStore.set(workstationDeviceCookieName, data[0].device_token, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 180,
    path: "/",
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
  })

  return {
    success:
      "Browser terdaftar. Minta admin menyetujui workstation sebelum membuka scan.",
  }
}

export { initialWorkstationActionState }
