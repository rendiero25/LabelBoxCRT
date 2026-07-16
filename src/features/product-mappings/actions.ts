"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/features/auth/server"
import type { ProductMappingActionState } from "@/features/product-mappings/form-state"
import {
  parseProductMappingInput,
  productMappingRpcErrorMessage,
} from "@/features/product-mappings/validation"
import { createClient } from "@/lib/supabase/server"

function mappingIdFromFormData(formData: FormData): string | null {
  const mappingId = formData.get("mappingId")
  return typeof mappingId === "string" && mappingId ? mappingId : null
}

function revalidateProductMappingPaths() {
  revalidatePath("/admin/product-mappings")
  revalidatePath("/admin/products")
  revalidatePath("/admin/master-items")
}

export async function createProductMappingAction(
  _previousState: ProductMappingActionState,
  formData: FormData,
): Promise<ProductMappingActionState> {
  await requireAdmin()
  const parsed = parseProductMappingInput(formData)
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("create_master_item_product_mapping", {
    p_master_item_id: parsed.data.masterItemId,
    p_product_id: parsed.data.productId,
  })

  if (error) return { error: productMappingRpcErrorMessage(error.message) }

  revalidateProductMappingPaths()
  return { success: "Product Mapping disimpan." }
}

export async function setProductMappingActiveAction(
  _previousState: ProductMappingActionState,
  formData: FormData,
): Promise<ProductMappingActionState> {
  await requireAdmin()
  const mappingId = mappingIdFromFormData(formData)
  const isActive = formData.get("isActive") === "true"
  if (!mappingId) return { error: "Product Mapping tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_master_item_product_active", {
    p_mapping_id: mappingId,
    p_is_active: isActive,
  })

  if (error) return { error: productMappingRpcErrorMessage(error.message) }

  revalidateProductMappingPaths()
  return {
    success: isActive
      ? "Product Mapping diaktifkan."
      : "Product Mapping dinonaktifkan.",
  }
}
