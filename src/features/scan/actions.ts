"use server"

import { createHash } from "node:crypto"

import { revalidatePath } from "next/cache"

import { parseBarcodeV1 } from "@/lib/barcode/parser"
import {
  type AcceptPackingScanActionResult,
  type AcceptPackingScanInput,
  type PackingSessionActionState,
} from "@/features/scan/form-state"
import { createClient } from "@/lib/supabase/server"

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function productDimensionsLookup(size: {
  dimension1: number
  dimension2: number
  length: number
}): string {
  return `${size.dimension1}x${size.dimension2}x${size.length}`
}

const safeRpcMessages: Record<string, string> = {
  BARCODE_PARSE_FAILED: "Format QR tidak valid.",
  BARCODE_PAYLOAD_TOO_LONG: "Payload QR melebihi batas yang diizinkan.",
  BARCODE_UNSUPPORTED_ENVELOPE: "Format QR belum didukung.",
  BARCODE_UNSUPPORTED_VERSION: "Versi QR belum didukung.",
  BOX_NOT_FOUND_OR_MISMATCH: "Box tidak ditemukan atau tidak sesuai dengan Master Item.",
  BOX_EMPTY: "Box ini belum punya requirement produk.",
  DELIVERY_DATE_INVALID: "Tanggal delivery tidak valid.",
  DELIVERY_NUMBER_SUPPLIER_INVALID: "Supplier tidak aktif atau tidak ditemukan.",
  LABEL_ALREADY_SCANNED: "Label ini sudah pernah diterima.",
  LABEL_UID_MISSING: "QR tidak memiliki Label UID unik.",
  LAYER_QUANTITY_FULL: "Kebutuhan layer untuk produk ini sudah penuh.",
  LOT_NO_INVALID: "Lot No wajib diisi (maksimal 100 karakter).",
  MASTER_ITEM_SUPPLIER_MISMATCH:
    "Master Item ini tidak terdaftar untuk supplier yang dipilih.",
  PACKING_SESSION_NOT_FOUND: "Packing session tidak ditemukan.",
  PRODUCT_NOT_ALLOWED_FOR_PART: "Produk tidak diizinkan untuk Master Item ini.",
  PRODUCT_NOT_REQUIRED_IN_BOX: "Produk tidak diperlukan oleh Box aktif.",
  PRODUCT_SIZE_NOT_FOUND: "Ukuran produk dari QR tidak ditemukan.",
  QTY_DELIVERY_INVALID: "Qty Delivery harus bilangan bulat lebih besar dari 0.",
  SESSION_NOT_ACCEPTING_SCAN: "Packing session tidak menerima scan.",
}

function rpcErrorMessage(code: string): string {
  return (
    safeRpcMessages[code] ?? "Aksi scan gagal. Coba lagi atau hubungi admin."
  )
}

function valueFromFormData(formData: FormData, name: string): string | null {
  const value = formData.get(name)
  return typeof value === "string" && value.trim() ? value : null
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  )
}

export async function startPackingSessionAction(
  _previousState: PackingSessionActionState,
  formData: FormData,
): Promise<PackingSessionActionState> {
  const masterItemId = valueFromFormData(formData, "masterItemId")
  const boxId = valueFromFormData(formData, "boxId")
  const supplierId = valueFromFormData(formData, "supplierId")
  const deliveryDate = valueFromFormData(formData, "deliveryDate")
  const lotNo = valueFromFormData(formData, "lotNo")
  const rawQtyDelivery = String(formData.get("qtyDelivery") ?? "").trim()

  if (
    !masterItemId ||
    !boxId ||
    !supplierId ||
    !uuidPattern.test(masterItemId) ||
    !uuidPattern.test(boxId) ||
    !uuidPattern.test(supplierId)
  ) {
    return { error: "Supplier, Master Item, dan Box wajib dipilih." }
  }

  if (!deliveryDate || !isIsoDate(deliveryDate)) {
    return { error: "Tanggal delivery tidak valid." }
  }

  if (!/^[1-9]\d{0,5}$/.test(rawQtyDelivery)) {
    return { error: "Qty Delivery harus bilangan bulat lebih besar dari 0." }
  }

  if (!lotNo || lotNo.trim().length > 100) {
    return { error: "Lot No wajib diisi (maksimal 100 karakter)." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("start_packing_session", {
    p_box_id: boxId,
    p_delivery_date: deliveryDate,
    p_lot_no: lotNo.trim(),
    p_master_item_id: masterItemId,
    p_qty_delivery: Number(rawQtyDelivery),
    p_supplier_id: supplierId,
  })

  if (error || !data?.[0]) {
    return { error: rpcErrorMessage(error?.message ?? "") }
  }

  revalidatePath("/scan")
  return {
    success: `Packing session dimulai (${data[0].delivery_number}). Scanner siap digunakan.`,
  }
}

export async function acceptPackingScanAction(
  input: AcceptPackingScanInput,
): Promise<AcceptPackingScanActionResult> {
  if (!uuidPattern.test(input.packingSessionId)) {
    return { message: "Packing session tidak valid.", status: "error" }
  }

  const parsed = parseBarcodeV1(input.rawPayload)
  if (!parsed.ok) {
    return { message: rpcErrorMessage(parsed.code), status: "error" }
  }

  // QR v1 nyata belum menyertakan label_uid; jangan menggunakan lot/reference
  // sebagai pengganti karena itu bukan identitas label fisik yang unik.
  if (!parsed.data.labelUid) {
    return { message: rpcErrorMessage("LABEL_UID_MISSING"), status: "error" }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("accept_packing_scan", {
    p_label_uid: parsed.data.labelUid,
    p_normalized_size: productDimensionsLookup(parsed.data.size),
    p_packing_session_id: input.packingSessionId,
    p_raw_payload_hash: createHash("sha256")
      .update(input.rawPayload)
      .digest("hex"),
    p_scanned_size: parsed.data.sizeNormalized,
  })

  if (error || !data?.[0]) {
    return { message: rpcErrorMessage(error?.message ?? ""), status: "error" }
  }

  const result = data[0]
  if (result.result === "accepted") {
    revalidatePath("/scan")
    return { message: "Scan diterima.", status: "success" }
  }

  if (result.error_code === "LABEL_ALREADY_SCANNED") {
    return { message: rpcErrorMessage(result.error_code), status: "duplicate" }
  }

  return {
    message: rpcErrorMessage(result.error_code ?? ""),
    status: "error",
  }
}
