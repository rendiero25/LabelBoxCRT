"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/features/auth/server"
import type { MasterItemActionState } from "@/features/master-items/form-state"
import {
  masterItemBoxRequirementsRpcErrorMessage,
  parseMasterItemBoxRequirementsInput,
} from "@/features/master-items/box-layer-requirements"
import {
  masterItemRpcErrorMessage,
  parseMasterItemInput,
} from "@/features/master-items/validation"
import { createClient } from "@/lib/supabase/server"

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function masterItemIdFromFormData(formData: FormData): string | null {
  const masterItemId = formData.get("masterItemId")
  return typeof masterItemId === "string" && masterItemId ? masterItemId : null
}

export async function createMasterItemAction(
  _previousState: MasterItemActionState,
  formData: FormData,
): Promise<MasterItemActionState> {
  await requireAdmin()
  const parsed = parseMasterItemInput(formData)
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("create_master_item", {
    p_item_code: parsed.data.itemCode,
    p_part_no: parsed.data.partNo,
    p_part_name: parsed.data.partName,
    p_unit: parsed.data.unit,
    p_default_label_qty: parsed.data.defaultLabelQty,
    p_item_sequence_code: parsed.data.itemSequenceCode ?? undefined,
  })

  if (error) return { error: masterItemRpcErrorMessage(error.message) }

  revalidatePath("/admin/master-items")
  return { success: "Master Item dibuat." }
}

export async function updateMasterItemAction(
  _previousState: MasterItemActionState,
  formData: FormData,
): Promise<MasterItemActionState> {
  await requireAdmin()
  const masterItemId = masterItemIdFromFormData(formData)
  const parsed = parseMasterItemInput(formData)
  if (!masterItemId) return { error: "Master Item tidak valid." }
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("update_master_item", {
    p_master_item_id: masterItemId,
    p_item_code: parsed.data.itemCode,
    p_part_no: parsed.data.partNo,
    p_part_name: parsed.data.partName,
    p_unit: parsed.data.unit,
    p_default_label_qty: parsed.data.defaultLabelQty,
    p_item_sequence_code: parsed.data.itemSequenceCode ?? undefined,
  })

  if (error) return { error: masterItemRpcErrorMessage(error.message) }

  revalidatePath("/admin/master-items")
  return { success: "Master Item diperbarui." }
}

export async function setMasterItemActiveAction(
  _previousState: MasterItemActionState,
  formData: FormData,
): Promise<MasterItemActionState> {
  await requireAdmin()
  const masterItemId = masterItemIdFromFormData(formData)
  const isActive = formData.get("isActive") === "true"
  if (!masterItemId) return { error: "Master Item tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_master_item_active", {
    p_master_item_id: masterItemId,
    p_is_active: isActive,
  })

  if (error) return { error: masterItemRpcErrorMessage(error.message) }

  revalidatePath("/admin/master-items")
  return {
    success: isActive
      ? "Master Item diaktifkan."
      : "Master Item dinonaktifkan.",
  }
}

export async function saveMasterItemBoxRequirementsAction(
  _previousState: MasterItemActionState,
  formData: FormData,
): Promise<MasterItemActionState> {
  await requireAdmin()
  const masterItemId = masterItemIdFromFormData(formData)
  const parsed = parseMasterItemBoxRequirementsInput(formData)
  if (!masterItemId || !uuidPattern.test(masterItemId)) {
    return { error: "Master Item tidak valid." }
  }
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("save_master_item_box_requirements", {
    p_master_item_id: masterItemId,
    p_box_definition_id: parsed.data.boxDefinitionId,
    p_layers: parsed.data.layers,
  })

  if (error) {
    return { error: masterItemBoxRequirementsRpcErrorMessage(error.message) }
  }

  revalidatePath("/admin/master-items")
  revalidatePath("/admin/box-definitions")
  return { success: "Produk per Box dan Layer disimpan." }
}
