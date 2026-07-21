"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/features/auth/server"
import type { ProductActionState } from "@/features/products/form-state"
import {
  parseProductCreateInput,
  parseProductInput,
  productRpcErrorMessage,
} from "@/features/products/validation"
import { createClient } from "@/lib/supabase/server"

function productIdFromFormData(formData: FormData): string | null {
  const productId = formData.get("productId")
  return typeof productId === "string" && productId ? productId : null
}

export async function createProductAction(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  await requireAdmin()
  const parsed = parseProductCreateInput(formData)
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("create_product", {
    p_part_name: parsed.data.partName,
    p_outer_diameter: parsed.data.outerDiameter,
    p_inner_diameter: parsed.data.innerDiameter,
    p_length: parsed.data.length,
  })

  if (error) return { error: productRpcErrorMessage(error.message) }

  revalidatePath("/admin/products")
  return { success: "Produk dibuat." }
}

export async function updateProductAction(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  await requireAdmin()
  const productId = productIdFromFormData(formData)
  const parsed = parseProductInput(formData)
  if (!productId) return { error: "Produk tidak valid." }
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("update_product", {
    p_product_id: productId,
    p_product_code: parsed.data.productCode,
    p_part_name: parsed.data.partName,
    p_outer_diameter: parsed.data.outerDiameter,
    p_inner_diameter: parsed.data.innerDiameter,
    p_length: parsed.data.length,
  })

  if (error) return { error: productRpcErrorMessage(error.message) }

  revalidatePath("/admin/products")
  return { success: "Produk diperbarui." }
}

export async function deleteProductAction(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  await requireAdmin()
  const productId = productIdFromFormData(formData)
  if (!productId) return { error: "Produk tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_product", {
    p_product_id: productId,
  })

  if (error) return { error: productRpcErrorMessage(error.message) }

  revalidatePath("/admin/products")
  return { success: "Produk dihapus." }
}

export async function setProductActiveAction(
  _previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  await requireAdmin()
  const productId = productIdFromFormData(formData)
  const isActive = formData.get("isActive") === "true"
  if (!productId) return { error: "Produk tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_product_active", {
    p_product_id: productId,
    p_is_active: isActive,
  })

  if (error) return { error: productRpcErrorMessage(error.message) }

  revalidatePath("/admin/products")
  return { success: isActive ? "Produk diaktifkan." : "Produk dinonaktifkan." }
}
