import { DeliverySessionWorkspace } from "@/features/delivery-verification/components/delivery-session-workspace"
import { type DeliverySession } from "@/features/delivery-verification/form-state"
import { requireActiveUser } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

type ScheduleRowRecord = {
  id: string
  row_no: number
  customer: string | null
  product_size: string
  qty_delivery: number
  // Null berarti ukurannya belum ada di MPQ Sheet; jumlah box-nya karena itu
  // ikut tidak diketahui, dan itu ditulis null pula -- bukan 0 maupun 1.
  mpq_qty: number | null
  expected_boxes: number | null
  verified_boxes: number | null
  source_file_name: string
  verified_at: string | null
}

type SessionRecord = {
  id: string
  session_no: number
  status: "open" | "done"
  created_at: string
}

export default async function VerifikasiPengirimanPage() {
  await requireActiveUser()

  const supabase = await createClient()

  // Dua query, bukan satu embed dengan baris tersarang: urutan baris jadwal
  // ditentukan row_no-nya sendiri, dan PostgREST mengurutkan relasi tersarang
  // per induk, bukan lintas keseluruhan.
  const [{ data: sessionRows }, { data: scheduleRows }] = await Promise.all([
    supabase
      .from("delivery_verification_sessions")
      .select("id, session_no, status, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("delivery_schedule_rows")
      .select(
        "id, session_id, row_no, customer, product_size, qty_delivery, mpq_qty, expected_boxes, verified_boxes, source_file_name, verified_at",
      )
      .order("row_no"),
  ])

  const rowsBySession = new Map<string, ScheduleRowRecord[]>()
  for (const row of (scheduleRows ?? []) as (ScheduleRowRecord & {
    session_id: string
  })[]) {
    const bucket = rowsBySession.get(row.session_id)
    if (bucket) bucket.push(row)
    else rowsBySession.set(row.session_id, [row])
  }

  const sessions: DeliverySession[] = (
    (sessionRows ?? []) as SessionRecord[]
  ).map((session) => ({
    createdAt: session.created_at,
    id: session.id,
    rows: (rowsBySession.get(session.id) ?? []).map((row) => ({
      customer: row.customer,
      expectedBoxes: row.expected_boxes,
      id: row.id,
      mpqQty: row.mpq_qty,
      productSize: row.product_size,
      qtyDelivery: row.qty_delivery,
      rowNo: row.row_no,
      sourceFileName: row.source_file_name,
      verifiedAt: row.verified_at,
      verifiedBoxes: row.verified_boxes,
    })),
    sessionNo: session.session_no,
    status: session.status,
  }))

  return <DeliverySessionWorkspace sessions={sessions} />
}
