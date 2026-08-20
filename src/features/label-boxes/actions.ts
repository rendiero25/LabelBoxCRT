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
  LABEL_BOX_BATCH_CLOSED:
    "Verifikasi batch ini sudah selesai, jadi isinya tidak bisa dirakit ulang. Hanya Delivery Number, tanggal, dan Lot No yang masih bisa diubah.",
  LABEL_BOX_BATCH_NOT_FOUND: "Data label box tidak ditemukan.",
  QTY_DELIVERY_DISPLAY_INVALID:
    "Packing Qty yang dicetak harus bilangan bulat lebih besar dari 0.",
  DELIVERY_NUMBER_INVALID:
    "Delivery Number wajib diisi (maksimal 100 karakter).",
  DELIVERY_NUMBER_NOT_ACTIVE:
    "Delivery Number ini sudah ditutup atau dibatalkan admin.",
  LOT_NO_INVALID: "Lot No wajib diisi (maksimal 100 karakter).",
  MASTER_ITEM_HAS_NO_BOX: "Master Item ini belum punya Box.",
  MASTER_ITEM_NOT_ACTIVE: "Master Item tidak aktif atau tidak ditemukan.",
  MASTER_ITEM_SUPPLIER_MISMATCH:
    "Master Item ini tidak terdaftar untuk supplier yang dipilih.",
  OPERATOR_NAME_INVALID: "Nama Operator wajib diisi (maksimal 100 karakter).",
  PACKING_DATE_INVALID: "Tanggal Packing tidak valid.",
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
 * Kelima field yang boleh disunting, dibaca dan divalidasi sekali supaya
 * pesan salahnya sama persis dengan yang dipakai saat membuat batch.
 */
function batchFieldsFromFormData(formData: FormData):
  | { error: string }
  | {
      deliveryDate: string
      deliveryNumber: string
      lotNo: string
      operatorName: string
      packingDate: string
    } {
  const deliveryNumber = valueFromFormData(formData, "deliveryNumber")
  const deliveryDate = valueFromFormData(formData, "deliveryDate")
  const packingDate = valueFromFormData(formData, "packingDate")
  const lotNo = valueFromFormData(formData, "lotNo")
  const operatorName = valueFromFormData(formData, "operatorName")

  if (!deliveryNumber || deliveryNumber.trim().length > 100) {
    return { error: "Delivery Number wajib diisi (maksimal 100 karakter)." }
  }

  if (!deliveryDate || !isIsoDate(deliveryDate)) {
    return { error: "Tanggal delivery tidak valid." }
  }

  if (!packingDate || !isIsoDate(packingDate)) {
    return { error: "Tanggal Packing tidak valid." }
  }

  if (!lotNo || lotNo.trim().length > 100) {
    return { error: "Lot No wajib diisi (maksimal 100 karakter)." }
  }

  if (!operatorName || operatorName.trim().length > 100) {
    return { error: "Nama Operator wajib diisi (maksimal 100 karakter)." }
  }

  return {
    deliveryDate,
    deliveryNumber: deliveryNumber.trim(),
    lotNo: lotNo.trim(),
    operatorName: operatorName.trim(),
    packingDate,
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
   * Satu-satunya angka jumlah yang diisi operator. Ia menentukan berapa set
   * label dibuat (dibagi Qty/Box Master Item) sekaligus jadi angka yang
   * tercetak di baris Qty/Delivery label.
   *
   * Formulirnya dulu punya dua field: "Qty Delivery" yang tersimpan sebagai
   * qty_delivery dan "Packing Qty" yang hanya dicetak (qty_delivery_display).
   * Keduanya nyaris selalu diisi angka yang sama dan tertukar tanpa ketahuan,
   * jadi yang kedua dibuang; kolom display-nya ikut angka ini lewat default
   * `coalesce` di RPC-nya.
   */
  const rawQtyDelivery = String(formData.get("qtyDelivery") ?? "").trim()

  if (
    !supplierId ||
    !masterItemId ||
    !uuidPattern.test(supplierId) ||
    !uuidPattern.test(masterItemId)
  ) {
    return { error: "Supplier dan Master Item wajib dipilih." }
  }

  const delivery = batchFieldsFromFormData(formData)
  if ("error" in delivery) return delivery

  if (!/^[1-9]\d{0,6}$/.test(rawQtyDelivery)) {
    return { error: "Qty Delivery harus bilangan bulat lebih besar dari 0." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_label_box_batch", {
    p_delivery_date: delivery.deliveryDate,
    p_delivery_number: delivery.deliveryNumber,
    p_lot_no: delivery.lotNo,
    p_master_item_id: masterItemId,
    p_operator_name: delivery.operatorName,
    p_packing_date: delivery.packingDate,
    p_qty_delivery: Number(rawQtyDelivery),
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
      packingDate: batch.packing_date,
      packingQty: batch.packing_qty,
      qtyDelivery: batch.qty_delivery,
      supplierCode: batch.supplier_code,
    },
    success: `${batch.label_count} label box dibuat untuk ${batch.delivery_number}.`,
  }
}

/**
 * Hanya Delivery Number, kedua tanggalnya, dan Lot No yang bisa disunting. Supplier,
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

  const delivery = batchFieldsFromFormData(formData)
  if ("error" in delivery) return delivery

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("update_label_box_batch", {
    p_batch_id: batchId,
    p_delivery_date: delivery.deliveryDate,
    p_delivery_number: delivery.deliveryNumber,
    p_lot_no: delivery.lotNo,
    p_operator_name: delivery.operatorName,
    p_packing_date: delivery.packingDate,
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

/**
 * Sunting penuh: seluruh isian formulir diganti dan batchnya dirakit ulang.
 *
 * Dipakai hanya untuk batch yang belum ditutup. Supplier, Master Item, dan Qty
 * menentukan berapa banyak nomor box yang ada, jadi mengubahnya berarti membuang
 * nomor box lama beserta hasil scannya dan memulainya lagi dari awal — dan
 * itulah yang diminta ketika data batch ternyata salah di tengah verifikasi.
 */
export async function rebuildLabelBoxBatchAction(
  _previousState: LabelBoxBatchActionState,
  formData: FormData,
): Promise<LabelBoxBatchActionState> {
  const batchId = valueFromFormData(formData, "batchId")
  const supplierId = valueFromFormData(formData, "supplierId")
  const masterItemId = valueFromFormData(formData, "masterItemId")

  if (
    !batchId ||
    !uuidPattern.test(batchId) ||
    !supplierId ||
    !uuidPattern.test(supplierId) ||
    !masterItemId ||
    !uuidPattern.test(masterItemId)
  ) {
    return { error: "Supplier dan Master Item wajib dipilih." }
  }

  const delivery = batchFieldsFromFormData(formData)
  if ("error" in delivery) return delivery

  const rawQtyDelivery = String(formData.get("qtyDelivery") ?? "").trim()

  if (!/^[1-9]\d{0,6}$/.test(rawQtyDelivery)) {
    return { error: "Qty Delivery harus bilangan bulat lebih besar dari 0." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("rebuild_label_box_batch", {
    p_batch_id: batchId,
    p_delivery_date: delivery.deliveryDate,
    p_delivery_number: delivery.deliveryNumber,
    p_lot_no: delivery.lotNo,
    p_master_item_id: masterItemId,
    p_operator_name: delivery.operatorName,
    p_packing_date: delivery.packingDate,
    p_qty_delivery: Number(rawQtyDelivery),
    p_supplier_id: supplierId,
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
    success: `Data label box ${data[0].delivery_number} diperbarui: ${data[0].label_count} nomor box dibuat ulang dan scannya dimulai dari awal.`,
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
