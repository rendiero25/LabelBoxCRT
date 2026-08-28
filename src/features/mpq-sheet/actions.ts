"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/features/auth/server"
import type { MpqActionState } from "@/features/mpq-sheet/form-state"
import {
  mpqRpcErrorMessage,
  parseMpqInput,
} from "@/features/mpq-sheet/validation"
import { createClient } from "@/lib/supabase/server"

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function rowIdFromFormData(formData: FormData): string | null {
  const rowId = formData.get("rowId")
  return typeof rowId === "string" && uuidPattern.test(rowId) ? rowId : null
}

export async function createMpqRowAction(
  _previousState: MpqActionState,
  formData: FormData,
): Promise<MpqActionState> {
  await requireAdmin()
  const parsed = parseMpqInput(formData)
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("create_mpq_sheet_row", {
    p_mpq_qty: parsed.data.mpqQty,
    p_product_size: parsed.data.productSize,
    p_unit: parsed.data.unit,
  })

  if (error) return { error: mpqRpcErrorMessage(error.message) }

  revalidatePath("/admin/mpq-sheet")
  return { success: `${parsed.data.productSize} ditambahkan.` }
}

export async function updateMpqRowAction(
  _previousState: MpqActionState,
  formData: FormData,
): Promise<MpqActionState> {
  await requireAdmin()
  const rowId = rowIdFromFormData(formData)
  const parsed = parseMpqInput(formData)
  if (!rowId) return { error: "Ukuran tidak valid." }
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("update_mpq_sheet_row", {
    p_mpq_qty: parsed.data.mpqQty,
    p_product_size: parsed.data.productSize,
    p_row_id: rowId,
    p_unit: parsed.data.unit,
  })

  if (error) return { error: mpqRpcErrorMessage(error.message) }

  revalidatePath("/admin/mpq-sheet")
  return { success: `${parsed.data.productSize} diperbarui.` }
}

export async function setMpqRowActiveAction(
  _previousState: MpqActionState,
  formData: FormData,
): Promise<MpqActionState> {
  await requireAdmin()
  const rowId = rowIdFromFormData(formData)
  const isActive = formData.get("isActive") === "true"
  if (!rowId) return { error: "Ukuran tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_mpq_sheet_row_active", {
    p_is_active: isActive,
    p_row_id: rowId,
  })

  if (error) return { error: mpqRpcErrorMessage(error.message) }

  revalidatePath("/admin/mpq-sheet")
  // Jadwal yang sudah berjalan tidak ikut berubah -- ia menyalin MPQ ke
  // barisnya sendiri saat diunggah -- jadi yang disebut hanya jadwal berikutnya.
  return {
    success: isActive
      ? "Ukuran diaktifkan."
      : "Ukuran dinonaktifkan. Jadwal baru akan memperlakukannya seperti belum ada MPQ.",
  }
}

export async function deleteMpqRowAction(
  _previousState: MpqActionState,
  formData: FormData,
): Promise<MpqActionState> {
  await requireAdmin()
  const rowId = rowIdFromFormData(formData)
  if (!rowId) return { error: "Ukuran tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_mpq_sheet_row", {
    p_row_id: rowId,
  })

  if (error) return { error: mpqRpcErrorMessage(error.message) }

  revalidatePath("/admin/mpq-sheet")
  return { success: "Ukuran dihapus." }
}
