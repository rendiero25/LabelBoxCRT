import { DeliverySessionWorkspace } from "@/features/delivery-verification/components/delivery-session-workspace"
import { type DeliverySession } from "@/features/delivery-verification/form-state"
import { requireActiveUser } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

type ScheduleRowRecord = {
  id: string
  row_no: number
  part_no: string
  qty: number
  source_file_name: string
  verified_at: string | null
}

type SessionRecord = {
  id: string
  session_no: number
  status: "open" | "done"
  created_at: string
  delivery_schedule_rows: ScheduleRowRecord[]
}

export default async function VerifikasiPengirimanPage() {
  await requireActiveUser()

  const supabase = await createClient()
  const { data } = await supabase
    .from("delivery_verification_sessions")
    .select(
      "id, session_no, status, created_at, delivery_schedule_rows(id, row_no, part_no, qty, source_file_name, verified_at)",
    )
    .order("created_at", { ascending: false })

  const sessions: DeliverySession[] = ((data ?? []) as SessionRecord[]).map(
    (session) => ({
      createdAt: session.created_at,
      id: session.id,
      // Urutan baris ditentukan di sini, bukan diserahkan ke urutan balik
      // Postgres: tanpa urutan yang dipatok, dua baris hasil satu upload bisa
      // bertukar tempat antar muat halaman dan operator kehilangan jejak nomor
      // barisnya.
      rows: [...session.delivery_schedule_rows]
        .sort((left, right) => left.row_no - right.row_no)
        .map((row) => ({
          id: row.id,
          partNo: row.part_no,
          qty: row.qty,
          rowNo: row.row_no,
          sourceFileName: row.source_file_name,
          verifiedAt: row.verified_at,
        })),
      sessionNo: session.session_no,
      status: session.status,
    }),
  )

  return <DeliverySessionWorkspace sessions={sessions} />
}
