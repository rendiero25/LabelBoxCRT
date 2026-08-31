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
import { scanMessage } from "@/features/delivery-verification/scan-message"
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
  DELIVERY_BOXES_BELOW_SCANNED:
    "Jumlah box tidak boleh lebih kecil dari box yang sudah discan. Untuk mengoreksi ke bawah, hapus barisnya lalu unggah ulang jadwalnya.",
  DELIVERY_BOXES_INVALID: "Jumlah box harus bilangan bulat, minimal 1.",
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
  SCHEDULE_NO_SHEET_ROWS:
    "File ini tidak memuat satu pun baris berdivisi sheet. Tube dan kabel tidak diverifikasi di halaman ini.",
  SCHEDULE_QTY_INVALID:
    "Ada Part No yang Qty-nya tidak terbaca sebagai bilangan bulat.",
}

function rpcErrorMessage(code: string, fallback: string): string {
  return safeRpcMessages[code] ?? fallback
}

/**
 * Sebagian RPC menitipkan keterangan pada `detail` -- daftar baris yang
 * bermasalah, misalnya. Isinya data kita sendiri, bukan pesan Postgres mentah,
 * jadi aman ditempelkan ke pesan yang dibaca operator.
 */
function rpcErrorDetail(detail: string | null | undefined): string {
  const text = detail?.trim()
  return text ? ` (${text})` : ""
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
      error:
        rpcErrorMessage(
          error?.message ?? "",
          "Gagal menyimpan jadwal. Coba lagi atau hubungi admin.",
        ) + rpcErrorDetail(error?.details),
    }
  }

  revalidatePath("/verifikasi-pengiriman")
  return {
    success: `${data.length} baris ditambahkan dari ${file.name}.`,
  }
}

/**
 * Mencocokkan satu hasil scan dengan jadwal session.
 *
 * Payload dikirim apa adanya ke RPC dan tidak diurai di sini. Yang mengurai
 * satu pihak saja -- RPC-nya -- supaya aturan "field kedua ukuran, field ketiga
 * Qty" tidak berdiri di dua tempat yang bisa berbeda pendapat.
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
  const message = scanMessage(row)

  revalidatePath("/verifikasi-pengiriman")
  return {
    deliveryOk: row.delivery_ok,
    message,
    outcome,
    totalCount: row.total_count,
    verifiedCount: row.verified_count,
  }
}

/**
 * Membuang satu session beserta jadwal dan catatan scannya.
 *
 * Yang hilang bukan cuma sessionnya melainkan seluruh bukti pemeriksaannya,
 * jadi RPC-nya menuliskan ringkasan ke audit_logs lebih dulu.
 */
export async function deleteDeliverySessionAction(
  sessionId: string,
): Promise<UploadScheduleState> {
  if (!uuidPattern.test(sessionId)) {
    return { error: "Session tidak valid." }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_delivery_verification_session", {
    p_session_id: sessionId,
  })

  if (error) {
    return {
      error: rpcErrorMessage(
        error.message,
        "Gagal menghapus session. Coba lagi atau hubungi admin.",
      ),
    }
  }

  revalidatePath("/verifikasi-pengiriman")
  return { success: "Session dihapus." }
}

/**
 * Mengisi jumlah box satu baris jadwal.
 *
 * Dokumen jadwal tidak menyebut berapa box yang berangkat -- yang tahu adalah
 * orang yang mengemasnya -- jadi angkanya diketik di layar sebelum barisnya
 * bisa discan.
 */
export async function setScheduleRowBoxesAction(input: {
  boxes: string
  rowId: string
}): Promise<UploadScheduleState> {
  if (!uuidPattern.test(input.rowId)) {
    return { error: "Baris jadwal tidak valid." }
  }

  const raw = input.boxes.trim()
  if (!/^\d+$/.test(raw)) {
    return { error: "Jumlah box harus bilangan bulat." }
  }

  const boxes = Number(raw)
  if (boxes < 1) return { error: "Jumlah box minimal 1." }
  if (boxes > 9999) return { error: "Jumlah box terlalu besar." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_delivery_schedule_row_boxes", {
    p_expected_boxes: boxes,
    p_row_id: input.rowId,
  })

  if (error) {
    return {
      error: rpcErrorMessage(
        error.message,
        "Gagal menyimpan jumlah box. Coba lagi atau hubungi admin.",
      ),
    }
  }

  revalidatePath("/verifikasi-pengiriman")
  return { success: `Jumlah box diisi ${boxes}.` }
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
