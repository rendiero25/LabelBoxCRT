"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/features/auth/server"
import type { DeliveryNumberActionState } from "@/features/delivery-numbers/form-state"
import {
  deliveryNumberRpcErrorMessage,
  parseDeliveryNumberInput,
} from "@/features/delivery-numbers/validation"
import { createClient } from "@/lib/supabase/server"

function deliveryNumberIdFromFormData(formData: FormData): string | null {
  const deliveryNumberId = formData.get("deliveryNumberId")
  return typeof deliveryNumberId === "string" && deliveryNumberId
    ? deliveryNumberId
    : null
}

export async function createDeliveryNumberAction(
  _previousState: DeliveryNumberActionState,
  formData: FormData,
): Promise<DeliveryNumberActionState> {
  await requireAdmin()
  const parsed = parseDeliveryNumberInput(formData, { allowStatus: true })
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("create_delivery_number", {
    p_supplier_id: parsed.data.supplierId,
    p_delivery_number: parsed.data.deliveryNumber,
    p_delivery_date: parsed.data.deliveryDate,
    p_status: parsed.data.status ?? "draft",
  })

  if (error) return { error: deliveryNumberRpcErrorMessage(error.message) }

  revalidatePath("/admin/delivery-numbers")
  return { success: "Delivery Number dibuat." }
}

export async function updateDeliveryNumberAction(
  _previousState: DeliveryNumberActionState,
  formData: FormData,
): Promise<DeliveryNumberActionState> {
  await requireAdmin()
  const deliveryNumberId = deliveryNumberIdFromFormData(formData)
  const parsed = parseDeliveryNumberInput(formData)
  if (!deliveryNumberId) return { error: "Delivery Number tidak valid." }
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("update_delivery_number", {
    p_delivery_number_id: deliveryNumberId,
    p_supplier_id: parsed.data.supplierId,
    p_delivery_number: parsed.data.deliveryNumber,
    p_delivery_date: parsed.data.deliveryDate,
  })

  if (error) return { error: deliveryNumberRpcErrorMessage(error.message) }

  revalidatePath("/admin/delivery-numbers")
  return { success: "Delivery Number diperbarui." }
}

export async function closeOrCancelDeliveryNumberAction(
  _previousState: DeliveryNumberActionState,
  formData: FormData,
): Promise<DeliveryNumberActionState> {
  await requireAdmin()
  const deliveryNumberId = deliveryNumberIdFromFormData(formData)
  const status = formData.get("status")
  if (!deliveryNumberId) return { error: "Delivery Number tidak valid." }
  if (status !== "closed" && status !== "cancelled") {
    return { error: "Perubahan status Delivery Number tidak valid." }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("close_or_cancel_delivery_number", {
    p_delivery_number_id: deliveryNumberId,
    p_status: status,
  })

  if (error) return { error: deliveryNumberRpcErrorMessage(error.message) }

  revalidatePath("/admin/delivery-numbers")
  return {
    success:
      status === "closed"
        ? "Delivery Number ditutup."
        : "Delivery Number dibatalkan.",
  }
}
