"use server"

import { revalidatePath } from "next/cache"

import {
  type CreateDeliverySessionState,
  type DeliveryScanResult,
  type UploadScheduleState,
} from "@/features/delivery-verification/form-state"
import {
  type ScheduleParseErrorCode,
  parseScheduleWorkbook,
} from "@/features/delivery-verification/schedule-excel"
import { createClient } from "@/lib/supabase/server"

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Sisi server menolak file besar sebelum membacanya, bukan sesudah. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

const safeRpcMessages: Record<string, string> = {
  ACTIVE_USER_REQUIRED: "Aksi ini hanya untuk pengguna aktif.",
  DELIVERY_ROWS_EMPTY: "File ini tidak berisi satu pun baris jadwal.",
  DELIVERY_ROWS_INVALID:
    "Ada baris yang Part No atau Qty-nya tidak terbaca. Periksa isinya lalu unggah lagi.",
  DELIVERY_ROW_NOT_FOUND: "Baris jadwal tidak ditemukan.",
  DELIVERY_SCAN_EMPTY: "Hasil scan kosong.",
  DELIVERY_SESSION_CLOSED:
    "Session ini sudah selesai, isinya tidak bisa diubah.",
  DELIVERY_SESSION_NOT_FOUND: "Session tidak ditemukan.",
  DELIVERY_SOURCE_FILE_INVALID: "Nama file tidak valid.",
}

/**
 * Kegagalan baca file dijelaskan sampai ke sebabnya. "Gagal membaca file" saja
 * membuat operator mengunggah dokumen yang sama berulang kali, padahal yang
 * salah judul kolomnya.
 */
const scheduleParseMessages: Record<ScheduleParseErrorCode, string> = {
  SCHEDULE_FILE_UNREADABLE:
    "File tidak terbaca sebagai Excel. Simpan ulang sebagai .xlsx lalu coba lagi.",
  SCHEDULE_HEADER_NOT_FOUND:
    "Kolom Part No dan Qty tidak ditemukan di file ini. Pastikan tabelnya berjudul kolom.",
  SCHEDULE_NO_ROWS: "Tidak ada baris berisi Part No di bawah judul kolomnya.",
  SCHEDULE_QTY_INVALID:
    "Ada Part No yang Qty-nya tidak terbaca sebagai bilangan bulat.",
}

function rpcErrorMessage(code: string, fallback: string): string {
  return safeRpcMessages[code] ?? fallback
}

export async function createDeliverySessionAction(): Promise<CreateDeliverySessionState> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc(
    "create_delivery_verification_session",
  )

  if (error || !data?.[0]) {
    return {
      error: rpcErrorMessage(
        error?.message ?? "",
        "Gagal membuat session. Coba lagi atau hubungi admin.",
      ),
    }
  }

  revalidatePath("/verifikasi-pengiriman")
  return { success: `Session ${data[0].session_no} dibuat.` }
}

/**
 * Membaca satu file jadwal lalu memasukkan seluruh barisnya sekaligus.
 *
 * Filenya dibaca di server, bukan di browser: parser Excel-nya besar dan tidak
 * perlu ikut turun ke workstation, dan isi dokumen jadwal tidak perlu melewati
 * kode klien yang bisa diubah.
 */
export async function uploadScheduleFileAction(
  _previousState: UploadScheduleState,
  formData: FormData,
): Promise<UploadScheduleState> {
  const sessionId = String(formData.get("sessionId") ?? "")
  if (!uuidPattern.test(sessionId)) {
    return { error: "Session tidak valid." }
  }

  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Pilih file jadwal lebih dulu." }
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: "File terlalu besar (maksimal 5 MB)." }
  }

  // PDF menyusul: pdfkit di project ini hanya bisa menulis PDF, dan membacanya
  // butuh pustaka baru yang parsernya harus diikat ke tata letak dokumen yang
  // sebenarnya. Menolaknya di sini lebih jujur daripada membiarkannya jatuh ke
  // pembaca Excel dan berbunyi "file tidak terbaca sebagai Excel".
  if (/\.pdf$/i.test(file.name)) {
    return {
      error: "Upload PDF belum tersedia. Untuk sekarang gunakan file Excel.",
    }
  }

  if (!/\.xlsx?$/i.test(file.name)) {
    return { error: "Format file harus Excel (.xlsx)." }
  }

  const parsed = await parseScheduleWorkbook(await file.arrayBuffer())
  if (!parsed.ok) {
    const detail = parsed.detail ? ` (${parsed.detail})` : ""
    return { error: `${scheduleParseMessages[parsed.code]}${detail}` }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("add_delivery_schedule_rows", {
    p_rows: parsed.rows,
    p_session_id: sessionId,
    p_source_file_name: file.name,
  })

  if (error || !data) {
    return {
      error: rpcErrorMessage(
        error?.message ?? "",
        "Gagal menyimpan jadwal. Coba lagi atau hubungi admin.",
      ),
    }
  }

  revalidatePath("/verifikasi-pengiriman")
  return {
    success: `${data.length} baris ditambahkan dari ${file.name}.`,
  }
}

/**
 * Mencocokkan satu label box hasil scan dengan jadwal session.
 *
 * Payload dikirim apa adanya ke RPC dan tidak diurai di sini. Tiga generasi QR
 * beredar dan dua di antaranya berbentuk sama persis sementara field ketiganya
 * berbeda arti, jadi angka apa pun yang dibaca dari string akan benar untuk
 * sebagian label dan salah untuk sisanya. RPC-nya mencari payload itu di
 * label_boxes dan mengambil angkanya dari batch.
 */
export async function verifyDeliveryLabelAction(input: {
  qrPayload: string
  sessionId: string
}): Promise<DeliveryScanResult> {
  const empty = { deliveryOk: false, totalCount: 0, verifiedCount: 0 }

  if (!uuidPattern.test(input.sessionId)) {
    return { ...empty, message: "Session tidak valid.", outcome: "error" }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("verify_delivery_label", {
    p_qr_payload: input.qrPayload,
    p_session_id: input.sessionId,
  })

  if (error || !data?.[0]) {
    return {
      ...empty,
      message: rpcErrorMessage(
        error?.message ?? "",
        "Scan gagal diproses. Coba lagi atau hubungi admin.",
      ),
      outcome: "error",
    }
  }

  const row = data[0]
  const outcome = row.result as DeliveryScanResult["outcome"]

  // Pesannya menyebut kenapa, bukan cuma PASS atau NOT PASS. Operator yang
  // hanya diberi "NOT PASS" akan mengulang scan label yang sama alih-alih
  // mencari label yang benar.
  const message =
    outcome === "pass"
      ? `PASS — ${row.product_size} (${row.qty}) cocok dengan ${row.part_no}.`
      : outcome === "duplicate_label"
        ? "NOT PASS — label ini sudah dipakai untuk baris lain di session ini."
        : outcome === "unknown_label"
          ? "NOT PASS — QR ini bukan label box yang dikenal sistem."
          : `NOT PASS — tidak ada baris jadwal yang cocok dengan ${row.part_no} (${row.packing_qty}).`

  revalidatePath("/verifikasi-pengiriman")
  return {
    deliveryOk: row.delivery_ok,
    message,
    outcome,
    totalCount: row.total_count,
    verifiedCount: row.verified_count,
  }
}

export async function deleteScheduleRowAction(
  rowId: string,
): Promise<UploadScheduleState> {
  if (!uuidPattern.test(rowId)) {
    return { error: "Baris jadwal tidak valid." }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_delivery_schedule_row", {
    p_row_id: rowId,
  })

  if (error) {
    return {
      error: rpcErrorMessage(
        error.message,
        "Gagal menghapus baris. Coba lagi atau hubungi admin.",
      ),
    }
  }

  revalidatePath("/verifikasi-pengiriman")
  return { success: "Baris jadwal dihapus." }
}
