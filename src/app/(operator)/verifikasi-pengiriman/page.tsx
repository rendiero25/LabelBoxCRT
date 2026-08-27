import { DeliverySessionWorkspace } from "@/features/delivery-verification/components/delivery-session-workspace"
import { type DeliverySession } from "@/features/delivery-verification/form-state"
import { requireActiveUser } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

type ScheduleRowRecord = {
  id: string
  row_no: number
  product_size: string
  qty: number
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
        "id, session_id, row_no, product_size, qty, source_file_name, verified_at",
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
      id: row.id,
      productSize: row.product_size,
      qty: row.qty,
      rowNo: row.row_no,
      sourceFileName: row.source_file_name,
      verifiedAt: row.verified_at,
    })),
    sessionNo: session.session_no,
    status: session.status,
  }))

  return <DeliverySessionWorkspace sessions={sessions} />
}
