"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/features/auth/server"
import type { SupplierActionState } from "@/features/suppliers/form-state"
import {
  parseSupplierInput,
  supplierRpcErrorMessage,
} from "@/features/suppliers/validation"
import { createClient } from "@/lib/supabase/server"

function supplierIdFromFormData(formData: FormData): string | null {
  const supplierId = formData.get("supplierId")
  return typeof supplierId === "string" && supplierId ? supplierId : null
}

export async function createSupplierAction(
  _previousState: SupplierActionState,
  formData: FormData,
): Promise<SupplierActionState> {
  await requireAdmin()
  const parsed = parseSupplierInput(formData)
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("create_supplier", {
    p_supplier_code: parsed.data.supplierCode,
    p_supplier_name: parsed.data.supplierName,
  })

  if (error) return { error: supplierRpcErrorMessage(error.message) }

  revalidatePath("/admin/suppliers")
  return { success: "Supplier dibuat." }
}

export async function updateSupplierAction(
  _previousState: SupplierActionState,
  formData: FormData,
): Promise<SupplierActionState> {
  await requireAdmin()
  const supplierId = supplierIdFromFormData(formData)
  const parsed = parseSupplierInput(formData)
  if (!supplierId) return { error: "Supplier tidak valid." }
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("update_supplier", {
    p_supplier_id: supplierId,
    p_supplier_code: parsed.data.supplierCode,
    p_supplier_name: parsed.data.supplierName,
  })

  if (error) return { error: supplierRpcErrorMessage(error.message) }

  revalidatePath("/admin/suppliers")
  return { success: "Supplier diperbarui." }
}

export async function setSupplierActiveAction(
  _previousState: SupplierActionState,
  formData: FormData,
): Promise<SupplierActionState> {
  await requireAdmin()
  const supplierId = supplierIdFromFormData(formData)
  const isActive = formData.get("isActive") === "true"
  if (!supplierId) return { error: "Supplier tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_supplier_active", {
    p_supplier_id: supplierId,
    p_is_active: isActive,
  })

  if (error) return { error: supplierRpcErrorMessage(error.message) }

  revalidatePath("/admin/suppliers")
  return {
    success: isActive ? "Supplier diaktifkan." : "Supplier dinonaktifkan.",
  }
}
