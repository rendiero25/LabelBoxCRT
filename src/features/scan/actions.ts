"use server"

import { createHash } from "node:crypto"

import { revalidatePath } from "next/cache"

import { parseBarcodeV1 } from "@/lib/barcode/parser"
import {
  type AcceptPackingScanActionResult,
  type AcceptPackingScanInput,
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
  LABEL_ALREADY_SCANNED: "Label ini sudah pernah diterima.",
  LABEL_UID_MISSING: "QR tidak memiliki Label UID unik.",
  LAYER_QUANTITY_FULL: "Kebutuhan layer untuk produk ini sudah penuh.",
  PACKING_SESSION_NOT_FOUND: "Packing session tidak ditemukan.",
  PRODUCT_NOT_ALLOWED_FOR_PART: "Produk tidak diizinkan untuk Master Item ini.",
  PRODUCT_NOT_REQUIRED_IN_BOX: "Produk tidak diperlukan oleh Box aktif.",
  PRODUCT_SIZE_NOT_FOUND: "Ukuran produk dari QR tidak ditemukan.",
  SESSION_NOT_ACCEPTING_SCAN: "Packing session tidak menerima scan.",
}

function rpcErrorMessage(code: string): string {
  return (
    safeRpcMessages[code] ?? "Aksi scan gagal. Coba lagi atau hubungi admin."
  )
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

  // Parser sudah menjamin label UID tidak kosong; sisa penjagaan panjang dan
  // keunikan dilakukan RPC.
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
