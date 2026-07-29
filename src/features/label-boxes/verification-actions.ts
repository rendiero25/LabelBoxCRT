"use server"

import { createHash } from "node:crypto"

import { revalidatePath } from "next/cache"

import { parseBarcodeV1 } from "@/lib/barcode/parser"
import {
  type CloseLabelBoxBatchActionState,
  type LabelBoxPrintJobsActionState,
  type LabelBoxScanInput,
  type LabelBoxScanResult,
} from "@/features/label-boxes/verification-form-state"
import { createClient } from "@/lib/supabase/server"

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const safeRpcMessages: Record<string, string> = {
  BARCODE_PARSE_FAILED: "Format QR tidak valid.",
  BARCODE_PAYLOAD_TOO_LONG: "Payload QR melebihi batas yang diizinkan.",
  BARCODE_UNSUPPORTED_ENVELOPE: "Format QR belum didukung.",
  BARCODE_UNSUPPORTED_VERSION: "Versi QR belum didukung.",
  LABEL_ALREADY_SCANNED: "Label ini sudah pernah diterima.",
  LABEL_BOX_BATCH_ALREADY_CLOSED: "Batch ini sudah ditutup sebelumnya.",
  LABEL_BOX_BATCH_CLOSED: "Batch sudah ditutup, scan tidak diterima lagi.",
  LABEL_BOX_BATCH_NOT_CLOSED:
    "Tutup verifikasi batch ini dulu sebelum mencetak.",
  LABEL_BOX_BATCH_NOT_FOUND: "Batch label box tidak ditemukan.",
  LABEL_BOX_OPERATOR_REQUIRED: "Aksi ini hanya untuk operator aktif.",
  LABEL_UID_MISSING: "QR tidak memiliki Label UID unik.",
  LAYER_QUANTITY_FULL: "Kebutuhan layer untuk produk ini sudah penuh.",
  NO_LABEL_BOX_AVAILABLE: "Semua label box pada batch ini sudah penuh.",
  PRODUCT_NOT_ALLOWED_FOR_PART: "Produk tidak diizinkan untuk Master Item ini.",
  PRODUCT_NOT_REQUIRED_IN_BOX: "Produk tidak diperlukan oleh Box aktif.",
  PRODUCT_SIZE_NOT_FOUND: "Ukuran produk dari QR tidak ditemukan.",
}

function rpcErrorMessage(code: string): string {
  return (
    safeRpcMessages[code] ?? "Aksi gagal. Coba lagi atau hubungi admin."
  )
}

function productDimensionsLookup(size: {
  dimension1: number
  dimension2: number
  length: number
}): string {
  return `${size.dimension1}x${size.dimension2}x${size.length}`
}

export async function acceptLabelBoxScanAction(
  input: LabelBoxScanInput,
): Promise<LabelBoxScanResult | { message: string; status: "error" }> {
  if (!uuidPattern.test(input.batchId)) {
    return { message: "Batch tidak valid.", status: "error" }
  }

  const parsed = parseBarcodeV1(input.rawPayload)
  if (!parsed.ok) {
    return { message: rpcErrorMessage(parsed.code), status: "error" }
  }

  if (!parsed.data.labelUid) {
    return { message: rpcErrorMessage("LABEL_UID_MISSING"), status: "error" }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("accept_label_box_scan", {
    p_batch_id: input.batchId,
    p_label_uid: parsed.data.labelUid,
    p_normalized_size: productDimensionsLookup(parsed.data.size),
    p_raw_payload_hash: createHash("sha256")
      .update(input.rawPayload)
      .digest("hex"),
    p_scanned_size: parsed.data.sizeNormalized,
  })

  if (error || !data?.[0]) {
    return { message: rpcErrorMessage(error?.message ?? ""), status: "error" }
  }

  const row = data[0]
  const status =
    row.result === "accepted"
      ? ("success" as const)
      : row.error_code === "LABEL_ALREADY_SCANNED"
        ? ("duplicate" as const)
        : ("error" as const)

  if (status === "success") revalidatePath(`/scan/${input.batchId}/verifikasi`)

  return {
    boxNumber: row.box_number,
    labelBoxId: row.label_box_id,
    labelBoxStatus: row.label_box_status,
    layerAcceptedQty: row.layer_accepted_qty,
    layerExpectedQty: row.layer_expected_qty,
    message:
      status === "success"
        ? `Scan diterima untuk ${row.box_number}.`
        : rpcErrorMessage(row.error_code ?? ""),
    status,
    totalAcceptedQty: row.total_accepted_qty,
    totalExpectedQty: row.total_expected_qty,
  }
}

export async function closeLabelBoxBatchAction(
  _previousState: CloseLabelBoxBatchActionState,
  formData: FormData,
): Promise<CloseLabelBoxBatchActionState> {
  const batchId = String(formData.get("batchId") ?? "").trim()

  if (!uuidPattern.test(batchId)) {
    return { error: "Batch tidak valid." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("close_label_box_batch", {
    p_batch_id: batchId,
  })

  if (error || !data?.[0]) {
    return { error: rpcErrorMessage(error?.message ?? "") }
  }

  revalidatePath("/scan")
  return {
    success: `Verifikasi ditutup. ${data[0].verified_count} dari ${data[0].label_count} box terverifikasi.`,
  }
}

export async function createLabelBoxPrintJobsAction(
  _previousState: LabelBoxPrintJobsActionState,
  formData: FormData,
): Promise<LabelBoxPrintJobsActionState> {
  const batchId = String(formData.get("batchId") ?? "").trim()

  if (!uuidPattern.test(batchId)) {
    return { error: "Batch tidak valid." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_label_box_print_jobs", {
    p_batch_id: batchId,
  })

  if (error || !data) {
    return { error: rpcErrorMessage(error?.message ?? "") }
  }

  revalidatePath("/scan")
  return {
    jobs: data.map((row) => ({
      boxName: row.box_name,
      boxNumber: row.box_number,
      deliveryDate: row.delivery_date,
      deliveryNumber: row.delivery_number,
      labelBoxId: row.label_box_id,
      labelReference: row.label_reference,
      lotNo: row.lot_no,
      partName: row.part_name,
      partNo: row.part_no,
      printJobId: row.print_job_id,
      qrPayload: row.qr_payload,
      qty: row.qty,
      qtyDelivery: row.qty_delivery,
      status: row.status,
      supplierCode: row.supplier_code,
    })),
    success: `${data.length} label siap dicetak.`,
  }
}
