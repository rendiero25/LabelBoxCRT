"use server"

import { revalidatePath } from "next/cache"

import {
  type LabelBoxBatchActionState,
} from "@/features/label-boxes/form-state"
import { createClient } from "@/lib/supabase/server"

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const safeRpcMessages: Record<string, string> = {
  DELIVERY_DATE_INVALID: "Tanggal delivery tidak valid.",
  DELIVERY_NUMBER_DATE_MISMATCH:
    "Delivery Number ini sudah terdaftar dengan tanggal berbeda.",
  DELIVERY_NUMBER_INVALID:
    "Delivery Number wajib diisi (maksimal 100 karakter).",
  DELIVERY_NUMBER_NOT_ACTIVE:
    "Delivery Number ini sudah ditutup atau dibatalkan admin.",
  LABEL_BOX_OPERATOR_REQUIRED: "Aksi ini hanya untuk pengguna aktif.",
  LOT_NO_INVALID: "Lot No wajib diisi (maksimal 100 karakter).",
  MASTER_ITEM_HAS_NO_BOX: "Master Item ini belum punya Box.",
  MASTER_ITEM_NOT_ACTIVE: "Master Item tidak aktif atau tidak ditemukan.",
  MASTER_ITEM_SUPPLIER_MISMATCH:
    "Master Item ini tidak terdaftar untuk supplier yang dipilih.",
  QTY_DELIVERY_INVALID:
    "Qty Delivery tidak valid (maksimal 99 kali Packing Qty).",
  QTY_DELIVERY_NOT_MULTIPLE:
    "Qty Delivery harus kelipatan Packing Qty Master Item.",
  SUPPLIER_INVALID: "Supplier tidak aktif atau tidak ditemukan.",
}

function rpcErrorMessage(code: string): string {
  return (
    safeRpcMessages[code] ??
    "Gagal membuat label box. Coba lagi atau hubungi admin."
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

export async function createLabelBoxBatchAction(
  _previousState: LabelBoxBatchActionState,
  formData: FormData,
): Promise<LabelBoxBatchActionState> {
  const supplierId = valueFromFormData(formData, "supplierId")
  const masterItemId = valueFromFormData(formData, "masterItemId")
  const deliveryNumber = valueFromFormData(formData, "deliveryNumber")
  const deliveryDate = valueFromFormData(formData, "deliveryDate")
  const lotNo = valueFromFormData(formData, "lotNo")
  const rawQtyDelivery = String(formData.get("qtyDelivery") ?? "").trim()

  if (
    !supplierId ||
    !masterItemId ||
    !uuidPattern.test(supplierId) ||
    !uuidPattern.test(masterItemId)
  ) {
    return { error: "Supplier dan Master Item wajib dipilih." }
  }

  if (!deliveryNumber || deliveryNumber.trim().length > 100) {
    return { error: "Delivery Number wajib diisi (maksimal 100 karakter)." }
  }

  if (!deliveryDate || !isIsoDate(deliveryDate)) {
    return { error: "Tanggal delivery tidak valid." }
  }

  if (!/^[1-9]\d{0,6}$/.test(rawQtyDelivery)) {
    return { error: "Qty Delivery harus bilangan bulat lebih besar dari 0." }
  }

  if (!lotNo || lotNo.trim().length > 100) {
    return { error: "Lot No wajib diisi (maksimal 100 karakter)." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_label_box_batch", {
    p_delivery_date: deliveryDate,
    p_delivery_number: deliveryNumber.trim(),
    p_lot_no: lotNo.trim(),
    p_master_item_id: masterItemId,
    p_qty_delivery: Number(rawQtyDelivery),
    p_supplier_id: supplierId,
  })

  if (error || !data?.[0]) {
    return { error: rpcErrorMessage(error?.message ?? "") }
  }

  const batch = data[0]
  const { data: labelBoxRows, error: labelBoxError } = await supabase
    .from("label_boxes")
    .select("box_number, qr_payload, set_no, box_no")
    .eq("batch_id", batch.batch_id)
    .order("set_no")
    .order("box_no")

  if (labelBoxError) {
    return {
      error:
        "Batch tersimpan tetapi daftar label gagal dimuat. Buka kembali halaman scan.",
    }
  }

  revalidatePath("/scan")
  return {
    result: {
      deliveryDate: batch.delivery_date,
      deliveryNumber: batch.delivery_number,
      itemCode: batch.item_code,
      labelBoxes: (labelBoxRows ?? []).map((row) => ({
        boxNumber: row.box_number,
        qrPayload: row.qr_payload,
      })),
      labelCount: batch.label_count,
      lotNo: batch.lot_no,
      masterItemRowNo: batch.master_item_row_no,
      packingQty: batch.packing_qty,
      qtyDelivery: batch.qty_delivery,
      supplierCode: batch.supplier_code,
    },
    success: `${batch.label_count} label box dibuat untuk ${batch.delivery_number}.`,
  }
}
