"use server"

import { revalidatePath } from "next/cache"

import {
  type FinalizePackingSessionActionState,
  type FinalizeSnapshot,
} from "@/features/finalize/form-state"
import { createClient } from "@/lib/supabase/server"

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const safeRpcMessages: Record<string, string> = {
  DELIVERY_NUMBER_INVALID:
    "Delivery Number session ini sudah tidak aktif. Hubungi admin.",
  PACKING_SESSION_NOT_FOUND: "Packing session tidak ditemukan.",
  PACKING_SESSION_OPERATOR_MISMATCH:
    "Packing session ini bukan milik operator aktif.",
  SESSION_NOT_COMPLETE: "Packing session belum lengkap untuk difinalisasi.",
}

function rpcErrorMessage(code: string): string {
  return (
    safeRpcMessages[code] ?? "Finalisasi gagal. Coba lagi atau hubungi admin."
  )
}

function valueFromFormData(formData: FormData, name: string): string | null {
  const value = formData.get(name)
  return typeof value === "string" && value.trim() ? value : null
}

export async function finalizePackingSessionAction(
  _previousState: FinalizePackingSessionActionState,
  formData: FormData,
): Promise<FinalizePackingSessionActionState> {
  const packingSessionId = valueFromFormData(formData, "packingSessionId")

  if (!packingSessionId || !uuidPattern.test(packingSessionId)) {
    return { error: "Packing session tidak valid." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("finalize_packing_session", {
    p_packing_session_id: packingSessionId,
  })

  if (error || !data?.[0]) {
    return { error: rpcErrorMessage(error?.message ?? "") }
  }

  const row = data[0]
  const snapshot: FinalizeSnapshot = {
    alreadyFinalized: row.already_finalized,
    boxCode: row.box_code,
    boxName: row.box_name,
    deliveryDate: row.delivery_date,
    deliveryNumber: row.delivery_number,
    labelReference: row.label_reference,
    lotNo: row.lot_no,
    packingSessionId: row.packing_session_id,
    partName: row.part_name,
    partNo: row.part_no,
    printJobId: row.print_job_id,
    qrGeneratedAt: row.qr_generated_at,
    qty: row.qty,
    qtyDelivery: row.qty_delivery,
    sequenceNo: row.sequence_no,
    sessionStatus: row.session_status,
    supplierCode: row.supplier_code,
  }

  revalidatePath("/scan")
  return {
    snapshot,
    success: row.already_finalized
      ? "Session ini sudah difinalisasi sebelumnya."
      : "Finalisasi berhasil. Print job dibuat.",
  }
}
