"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/features/auth/server"
import type { BoxActionState } from "@/features/boxes/form-state"
import {
  boxRpcErrorMessage,
  parseBoxInput,
  type BoxLayerInput,
} from "@/features/boxes/validation"
import { createClient } from "@/lib/supabase/server"
import type { Json } from "@/types/database"

function boxIdFromFormData(formData: FormData): string | null {
  const boxId = formData.get("boxId")
  return typeof boxId === "string" && boxId ? boxId : null
}

function rpcLayers(layers: BoxLayerInput[]): Json {
  return layers.map((layer) => ({ name: layer.name }))
}

function revalidateBoxes() {
  revalidatePath("/admin/boxes")
  revalidatePath("/admin/master-items")
}

export async function createBoxAction(
  _previousState: BoxActionState,
  formData: FormData,
): Promise<BoxActionState> {
  await requireAdmin()
  const parsed = parseBoxInput(formData)
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("create_box", {
    p_box_name: parsed.data.boxName,
    p_layers: rpcLayers(parsed.data.layers),
  })

  if (error) return { error: boxRpcErrorMessage(error.message) }

  revalidateBoxes()
  return { success: "Box dibuat." }
}

export async function updateBoxAction(
  _previousState: BoxActionState,
  formData: FormData,
): Promise<BoxActionState> {
  await requireAdmin()
  const boxId = boxIdFromFormData(formData)
  const parsed = parseBoxInput(formData)
  if (!boxId) return { error: "Box tidak valid." }
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("update_box", {
    p_box_id: boxId,
    p_box_name: parsed.data.boxName,
    p_layers: rpcLayers(parsed.data.layers),
  })

  if (error) return { error: boxRpcErrorMessage(error.message) }

  revalidateBoxes()
  return { success: "Box diperbarui." }
}

export async function setBoxActiveAction(
  _previousState: BoxActionState,
  formData: FormData,
): Promise<BoxActionState> {
  await requireAdmin()
  const boxId = boxIdFromFormData(formData)
  const isActive = formData.get("isActive") === "true"
  if (!boxId) return { error: "Box tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_box_active", {
    p_box_id: boxId,
    p_is_active: isActive,
  })

  if (error) return { error: boxRpcErrorMessage(error.message) }

  revalidateBoxes()
  return { success: isActive ? "Box diaktifkan." : "Box dinonaktifkan." }
}

export async function deleteBoxAction(
  _previousState: BoxActionState,
  formData: FormData,
): Promise<BoxActionState> {
  await requireAdmin()
  const boxId = boxIdFromFormData(formData)
  if (!boxId) return { error: "Box tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_box", { p_box_id: boxId })

  if (error) return { error: boxRpcErrorMessage(error.message) }

  revalidateBoxes()
  return { success: "Box dihapus." }
}
