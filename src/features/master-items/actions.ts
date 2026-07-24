"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/features/auth/server"
import type { MasterItemActionState } from "@/features/master-items/form-state"
import {
  masterItemBoxRpcErrorMessage,
  parseLayerRequirementsPayload,
} from "@/features/master-items/box-layer-requirements"
import {
  masterItemRpcErrorMessage,
  parseMasterItemInput,
} from "@/features/master-items/validation"
import { createClient } from "@/lib/supabase/server"
import type { Json } from "@/types/database"

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
    p_part_no: parsed.data.partNo,
    p_part_name: parsed.data.partName,
    p_unit: parsed.data.unit,
    p_default_label_qty: parsed.data.defaultLabelQty,
    p_supplier_id: parsed.data.supplierId ?? undefined,
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
  const layerRequirements = parseLayerRequirementsPayload(formData)
  if ("error" in layerRequirements) return { error: layerRequirements.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("update_master_item", {
    p_master_item_id: masterItemId,
    p_part_no: parsed.data.partNo,
    p_part_name: parsed.data.partName,
    p_unit: parsed.data.unit,
    p_default_label_qty: parsed.data.defaultLabelQty,
    p_supplier_id: parsed.data.supplierId ?? undefined,
  })

  if (error) return { error: masterItemRpcErrorMessage(error.message) }

  for (const layer of layerRequirements.data) {
    const { error: layerError } = await supabase.rpc(
      "save_box_layer_requirements",
      {
        p_box_layer_id: layer.boxLayerId,
        p_requirements: layer.requirements.map((requirement) => ({
          product_id: requirement.productId,
          expected_qty: requirement.expectedQty,
        })) as Json,
      },
    )
    if (layerError) {
      return { error: masterItemBoxRpcErrorMessage(layerError.message) }
    }
  }

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

export async function deleteMasterItemAction(
  _previousState: MasterItemActionState,
  formData: FormData,
): Promise<MasterItemActionState> {
  await requireAdmin()
  const masterItemId = masterItemIdFromFormData(formData)
  if (!masterItemId) return { error: "Master Item tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_master_item", {
    p_master_item_id: masterItemId,
  })

  if (error) return { error: masterItemRpcErrorMessage(error.message) }

  revalidatePath("/admin/master-items")
  return { success: "Master Item dihapus." }
}

function revalidateMasterItems() {
  revalidatePath("/admin/master-items")
}

export async function createMasterItemBoxAction(
  _previousState: MasterItemActionState,
  formData: FormData,
): Promise<MasterItemActionState> {
  await requireAdmin()
  const masterItemId = masterItemIdFromFormData(formData)
  if (!masterItemId) return { error: "Master Item tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("create_master_item_box", {
    p_master_item_id: masterItemId,
  })

  if (error) return { error: masterItemBoxRpcErrorMessage(error.message) }

  revalidateMasterItems()
  return { success: "Box dibuat." }
}

export async function deleteMasterItemBoxAction(
  _previousState: MasterItemActionState,
  formData: FormData,
): Promise<MasterItemActionState> {
  await requireAdmin()
  const boxId = String(formData.get("boxId") ?? "").trim()
  if (!boxId) return { error: "Box tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_master_item_box", {
    p_box_id: boxId,
  })

  if (error) return { error: masterItemBoxRpcErrorMessage(error.message) }

  revalidateMasterItems()
  return { success: "Box dihapus." }
}

export async function createBoxLayerAction(
  _previousState: MasterItemActionState,
  formData: FormData,
): Promise<MasterItemActionState> {
  await requireAdmin()
  const boxId = String(formData.get("boxId") ?? "").trim()
  if (!boxId) return { error: "Box tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("create_box_layer", {
    p_box_id: boxId,
  })

  if (error) return { error: masterItemBoxRpcErrorMessage(error.message) }

  revalidateMasterItems()
  return { success: "Layer ditambahkan." }
}

export async function deleteBoxLayerAction(
  _previousState: MasterItemActionState,
  formData: FormData,
): Promise<MasterItemActionState> {
  await requireAdmin()
  const boxLayerId = String(formData.get("boxLayerId") ?? "").trim()
  if (!boxLayerId) return { error: "Layer tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_box_layer", {
    p_box_layer_id: boxLayerId,
  })

  if (error) return { error: masterItemBoxRpcErrorMessage(error.message) }

  revalidateMasterItems()
  return { success: "Layer dihapus." }
}
