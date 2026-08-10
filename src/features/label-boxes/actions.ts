"use server"

import { revalidatePath } from "next/cache"

import { type LabelBoxBatchActionState } from "@/features/label-boxes/form-state"
import { createClient } from "@/lib/supabase/server"

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const safeRpcMessages: Record<string, string> = {
  ACTIVE_USER_REQUIRED: "Aksi ini hanya untuk pengguna aktif.",
  DELIVERY_DATE_INVALID: "Tanggal delivery tidak valid.",
  DELIVERY_NUMBER_DATE_MISMATCH:
    "Delivery Number ini sudah terdaftar dengan tanggal berbeda.",
  DELIVERY_NUMBER_DATE_SHARED:
    "Delivery Number ini dipakai batch lain, jadi tanggalnya tidak bisa diubah dari sini.",
  LABEL_BOX_BATCH_NOT_FOUND: "Data label box tidak ditemukan.",
  DELIVERY_NUMBER_INVALID:
    "Delivery Number wajib diisi (maksimal 100 karakter).",
  DELIVERY_NUMBER_NOT_ACTIVE:
    "Delivery Number ini sudah ditutup atau dibatalkan admin.",
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

/**
 * Pesan cadangannya ikut aksinya. Kegagalan hapus yang berbunyi "gagal membuat
 * label box" mengirim operator mencari masalah di tempat yang salah.
 */
function rpcErrorMessage(code: string, fallback: string): string {
  return safeRpcMessages[code] ?? fallback
}

/**
 * Ketiga field yang boleh disunting, dibaca dan divalidasi sekali supaya
 * pesan salahnya sama persis dengan yang dipakai saat membuat batch.
 */
function deliveryFieldsFromFormData(formData: FormData):
  | { error: string }
  | {
      deliveryDate: string
      deliveryNumber: string
      lotNo: string
    } {
  const deliveryNumber = valueFromFormData(formData, "deliveryNumber")
  const deliveryDate = valueFromFormData(formData, "deliveryDate")
  const lotNo = valueFromFormData(formData, "lotNo")

  if (!deliveryNumber || deliveryNumber.trim().length > 100) {
    return { error: "Delivery Number wajib diisi (maksimal 100 karakter)." }
  }

  if (!deliveryDate || !isIsoDate(deliveryDate)) {
    return { error: "Tanggal delivery tidak valid." }
  }

  if (!lotNo || lotNo.trim().length > 100) {
    return { error: "Lot No wajib diisi (maksimal 100 karakter)." }
  }

  return {
    deliveryDate,
    deliveryNumber: deliveryNumber.trim(),
    lotNo: lotNo.trim(),
  }
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
  /**
   * Dua angka yang mudah tertukar. Yang diisi di field "Packing Qty" adalah
   * keping yang dipak: itu yang dibagi Qty/Box Master Item menjadi jumlah set
   * label, dan di database namanya qty_delivery. Yang diisi di field "Qty
   * Delivery" hanya dicetak di baris Qty/Delivery label dan tidak menentukan
   * apa pun.
   */
  const rawPackingQty = String(formData.get("packingQty") ?? "").trim()
  const rawQtyDelivery = String(formData.get("qtyDelivery") ?? "").trim()

  if (
    !supplierId ||
    !masterItemId ||
    !uuidPattern.test(supplierId) ||
    !uuidPattern.test(masterItemId)
  ) {
    return { error: "Supplier dan Master Item wajib dipilih." }
  }

  const delivery = deliveryFieldsFromFormData(formData)
  if ("error" in delivery) return delivery

  if (!/^[1-9]\d{0,6}$/.test(rawPackingQty)) {
    return { error: "Packing Qty harus bilangan bulat lebih besar dari 0." }
  }

  if (!/^[1-9]\d{0,6}$/.test(rawQtyDelivery)) {
    return { error: "Qty Delivery harus bilangan bulat lebih besar dari 0." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_label_box_batch", {
    p_delivery_date: delivery.deliveryDate,
    p_delivery_number: delivery.deliveryNumber,
    p_lot_no: delivery.lotNo,
    p_master_item_id: masterItemId,
    p_qty_delivery: Number(rawPackingQty),
    p_qty_delivery_display: Number(rawQtyDelivery),
    p_supplier_id: supplierId,
  })

  if (error || !data?.[0]) {
    return {
      error: rpcErrorMessage(
        error?.message ?? "",
        "Gagal membuat label box. Coba lagi atau hubungi admin.",
      ),
    }
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
      qtyDelivery: batch.qty_delivery_display,
      supplierCode: batch.supplier_code,
    },
    success: `${batch.label_count} label box dibuat untuk ${batch.delivery_number}.`,
  }
}

/**
 * Hanya Delivery Number, tanggalnya, dan Lot No yang bisa disunting. Supplier,
 * Master Item, dan Qty Delivery menentukan berapa dan nomor berapa saja label
 * boxnya; mengubah itu berarti membuat batch baru, bukan menyunting yang ada.
 */
export async function updateLabelBoxBatchAction(
  _previousState: LabelBoxBatchActionState,
  formData: FormData,
): Promise<LabelBoxBatchActionState> {
  const batchId = valueFromFormData(formData, "batchId")
  if (!batchId || !uuidPattern.test(batchId)) {
    return { error: "Data label box tidak valid." }
  }

  const delivery = deliveryFieldsFromFormData(formData)
  if ("error" in delivery) return delivery

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("update_label_box_batch", {
    p_batch_id: batchId,
    p_delivery_date: delivery.deliveryDate,
    p_delivery_number: delivery.deliveryNumber,
    p_lot_no: delivery.lotNo,
  })

  if (error || !data?.[0]) {
    return {
      error: rpcErrorMessage(
        error?.message ?? "",
        "Gagal memperbarui data label box. Coba lagi atau hubungi admin.",
      ),
    }
  }

  revalidatePath("/scan")
  return {
    success: `Data label box ${data[0].delivery_number} diperbarui.`,
  }
}

export async function deleteLabelBoxBatchAction(
  _previousState: LabelBoxBatchActionState,
  formData: FormData,
): Promise<LabelBoxBatchActionState> {
  const batchId = valueFromFormData(formData, "batchId")
  if (!batchId || !uuidPattern.test(batchId)) {
    return { error: "Data label box tidak valid." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("delete_label_box_batch", {
    p_batch_id: batchId,
  })

  if (error || !data?.[0]) {
    return {
      error: rpcErrorMessage(
        error?.message ?? "",
        "Gagal menghapus data label box. Coba lagi atau hubungi admin.",
      ),
    }
  }

  revalidatePath("/scan")
  return {
    success: `Data label box dihapus berikut ${data[0].deleted_label_count} nomor box.`,
  }
}
