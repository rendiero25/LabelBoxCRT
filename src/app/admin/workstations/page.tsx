import { MonitorCogIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import { RegisterWorkstationForm } from "@/features/workstations/components/register-workstation-form"
import { WorkstationRowActions } from "@/features/workstations/components/workstation-row-actions"
import { requireAdmin } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

const statusLabels = {
  pending: "Menunggu enrollment",
  approved: "Aktif",
  disabled: "Nonaktif",
} as const

export default async function WorkstationsPage() {
  await requireAdmin()
  const supabase = await createClient()
  const [
    { data: workstations, error: workstationError },
    { data: operators, error: operatorError },
  ] = await Promise.all([
    supabase.rpc("list_workstations_for_admin"),
    supabase
      .from("profiles")
      .select("id, display_name")
      .eq("role", "operator")
      .eq("is_active", true)
      .order("display_name"),
  ])

  const error = workstationError ?? operatorError

  return (
    <div className="flex max-w-6xl flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Workstations</h1>
        <p className="text-muted-foreground text-sm">
          Identitas perangkat memakai token acak HttpOnly di browser, terikat ke
          operator dan persetujuan admin. Bukan localStorage.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <MonitorCogIcon />
          <AlertTitle>Data workstation tidak dapat dimuat</AlertTitle>
          <AlertDescription>
            Periksa koneksi Supabase atau izin admin.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="rounded-xl border p-5">
        <h2 className="mb-5 font-medium">Daftarkan workstation baru</h2>
        <RegisterWorkstationForm operators={operators ?? []} />
      </section>

      <section className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Workstation</TableHead>
              <TableHead>Perangkat</TableHead>
              <TableHead>Operator</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Terakhir terlihat</TableHead>
              <TableHead>Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(workstations ?? []).map((workstation) => (
              <TableRow key={workstation.id}>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">
                      {workstation.workstation_code}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {workstation.name}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1 text-xs">
                    <span>{workstation.printer_name}</span>
                    <span className="text-muted-foreground">
                      {workstation.printer_model} · {workstation.scanner_model}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  {operators?.find(
                    (operator) =>
                      operator.id === workstation.assigned_operator_id,
                  )?.display_name ?? "—"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <Badge
                      variant={
                        workstation.approval_status === "approved"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {statusLabels[workstation.approval_status]}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {workstation.has_active_device
                        ? "Browser terdaftar"
                        : "Browser belum terdaftar"}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {workstation.last_seen_at
                    ? new Date(workstation.last_seen_at).toLocaleString("id-ID")
                    : "Belum pernah"}
                </TableCell>
                <TableCell>
                  <WorkstationRowActions
                    approvalStatus={workstation.approval_status}
                    hasActiveDevice={workstation.has_active_device}
                    workstationId={workstation.id}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  )
}
