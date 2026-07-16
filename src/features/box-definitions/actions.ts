"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/features/auth/server"
import type { BoxDefinitionActionState } from "@/features/box-definitions/form-state"
import {
  boxDefinitionRpcErrorMessage,
  parseBoxDefinitionInput,
  type BoxLayerInput,
} from "@/features/box-definitions/validation"
import { createClient } from "@/lib/supabase/server"
import type { Json } from "@/types/database"

function boxDefinitionIdFromFormData(formData: FormData): string | null {
  const boxDefinitionId = formData.get("boxDefinitionId")
  return typeof boxDefinitionId === "string" && boxDefinitionId
    ? boxDefinitionId
    : null
}

function rpcLayers(layers: BoxLayerInput[]): Json {
  return layers.map((layer) => ({
    name: layer.name,
    requirements: layer.requirements.map((requirement) => ({
      product_id: requirement.productId,
      expected_qty: requirement.expectedQty,
    })),
  }))
}

function revalidateBoxDefinitions() {
  revalidatePath("/admin/box-definitions")
}

export async function createBoxDefinitionAction(
  _previousState: BoxDefinitionActionState,
  formData: FormData,
): Promise<BoxDefinitionActionState> {
  await requireAdmin()
  const parsed = parseBoxDefinitionInput(formData)
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("create_box_definition", {
    p_master_item_id: parsed.data.masterItemId,
    p_box_code: parsed.data.boxCode,
    p_box_name: parsed.data.boxName,
    p_layers: rpcLayers(parsed.data.layers),
  })

  if (error) return { error: boxDefinitionRpcErrorMessage(error.message) }

  revalidateBoxDefinitions()
  return { success: "Definisi box dibuat." }
}

export async function updateBoxDefinitionAction(
  _previousState: BoxDefinitionActionState,
  formData: FormData,
): Promise<BoxDefinitionActionState> {
  await requireAdmin()
  const boxDefinitionId = boxDefinitionIdFromFormData(formData)
  const parsed = parseBoxDefinitionInput(formData)
  if (!boxDefinitionId) return { error: "Definisi box tidak valid." }
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("update_box_definition", {
    p_box_definition_id: boxDefinitionId,
    p_box_code: parsed.data.boxCode,
    p_box_name: parsed.data.boxName,
    p_layers: rpcLayers(parsed.data.layers),
  })

  if (error) return { error: boxDefinitionRpcErrorMessage(error.message) }

  revalidateBoxDefinitions()
  return { success: "Definisi box diperbarui." }
}

export async function publishBoxDefinitionAction(
  _previousState: BoxDefinitionActionState,
  formData: FormData,
): Promise<BoxDefinitionActionState> {
  await requireAdmin()
  const boxDefinitionId = boxDefinitionIdFromFormData(formData)
  if (!boxDefinitionId) return { error: "Definisi box tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("publish_box_definition", {
    p_box_definition_id: boxDefinitionId,
  })

  if (error) return { error: boxDefinitionRpcErrorMessage(error.message) }

  revalidateBoxDefinitions()
  return { success: "Definisi box dipublikasikan." }
}

export async function cloneBoxDefinitionVersionAction(
  _previousState: BoxDefinitionActionState,
  formData: FormData,
): Promise<BoxDefinitionActionState> {
  await requireAdmin()
  const boxDefinitionId = boxDefinitionIdFromFormData(formData)
  if (!boxDefinitionId) return { error: "Definisi box tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("clone_box_definition_version", {
    p_box_definition_id: boxDefinitionId,
  })

  if (error) return { error: boxDefinitionRpcErrorMessage(error.message) }

  revalidateBoxDefinitions()
  return { success: "Versi draft baru dibuat." }
}
