import { NextResponse } from "next/server"

import {
  historyExportFilename,
  isExportFormat,
} from "@/features/master-items/history-export"
import { buildMasterItemHistoryCsv } from "@/features/master-items/history-export-csv"
import { buildLabelBoxHistoryPdf } from "@/features/master-items/history-export-pdf"
import { buildMasterItemHistoryWorkbook } from "@/features/master-items/history-export-xlsx"
import { loadMasterItemHistory } from "@/features/master-items/history"
import { requireAdmin } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

/**
 * Riwayat satu label box sebagai berkas Excel, CSV, atau PDF.
 *
 * Lingkupnya satu box, bukan seluruh Master Item: pertanyaan admin hampir
 * selalu tentang satu box tertentu, dan berkas berisi ratusan box menuntut
 * penerimanya menyaring ulang apa yang sudah disaring di layar.
 *
 * Dirakit di server, bukan di browser: datanya dibaca lewat klien Supabase yang
 * sama dengan halamannya, jadi RLS dan penjagaan admin berlaku pada jalur yang
 * persis sama.
 */

// pdfkit membaca berkas metrik fontnya dari disk saat dijalankan; dibundel
// Turbopack berkas itu ikut hilang dan dokumennya gagal dirakit.
export const runtime = "nodejs"

const CONTENT_TYPE = {
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const

export async function GET(
  request: Request,
  { params }: { params: Promise<{ masterItemId: string }> },
) {
  await requireAdmin()
  const { masterItemId } = await params

  const url = new URL(request.url)
  const requestedFormat = url.searchParams.get("format") ?? "xlsx"
  if (!isExportFormat(requestedFormat)) {
    return NextResponse.json(
      { error: "Format ekspor tidak dikenal." },
      { status: 400 },
    )
  }

  const labelBoxId = url.searchParams.get("labelBox")
  if (!labelBoxId) {
    return NextResponse.json(
      { error: "Label box yang diekspor belum ditentukan." },
      { status: 400 },
    )
  }
  const sectionKey = url.searchParams.get("section") ?? "label-box"

  const supabase = await createClient()
  const { data: masterItem, error } = await supabase
    .from("master_items")
    .select("item_code, part_no, part_name")
    .eq("id", masterItemId)
    .maybeSingle()

  if (error || !masterItem) {
    return NextResponse.json(
      { error: "Master Item tidak ditemukan." },
      { status: 404 },
    )
  }

  const history = await loadMasterItemHistory(supabase, masterItemId)
  if (history.error) {
    return NextResponse.json({ error: history.error }, { status: 502 })
  }

  // Box dicari di dalam riwayat Master Item ini, bukan dibaca langsung dari
  // tabelnya: box milik Master Item lain karena itu tidak bisa ikut terunduh
  // hanya dengan menukar id di URL.
  const row = history.rows.find(
    (candidate) => candidate.labelBoxId === labelBoxId,
  )
  if (!row) {
    return NextResponse.json(
      { error: "Label box tidak ditemukan pada Master Item ini." },
      { status: 404 },
    )
  }

  const meta = {
    itemCode: masterItem.item_code,
    partName: masterItem.part_name,
    partNo: masterItem.part_no,
  }
  const now = new Date()

  let body: ArrayBuffer | Buffer | string
  let filename: string

  if (requestedFormat === "csv") {
    const csv = buildMasterItemHistoryCsv([row], sectionKey)
    if (csv === null) {
      return NextResponse.json(
        { error: "Bagian riwayat tidak dikenal." },
        { status: 400 },
      )
    }
    body = csv
    filename = historyExportFilename(masterItem.item_code, now, "csv", [
      row.boxNumber,
      sectionKey,
    ])
  } else if (requestedFormat === "pdf") {
    body = await buildLabelBoxHistoryPdf(meta, row, now)
    filename = historyExportFilename(masterItem.item_code, now, "pdf", [
      row.boxNumber,
    ])
  } else {
    const workbook = buildMasterItemHistoryWorkbook(meta, [row])
    body = (await workbook.xlsx.writeBuffer()) as ArrayBuffer
    filename = historyExportFilename(masterItem.item_code, now, "xlsx", [
      row.boxNumber,
    ])
  }

  return new NextResponse(body as BodyInit, {
    headers: {
      // Berkas ini memuat data pengiriman; disimpan proxy mana pun ia jadi
      // salinan yang tidak pernah ditagih siapa-siapa.
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${filename}"`,
      "content-type": CONTENT_TYPE[requestedFormat],
    },
  })
}
