"use client"

import { useActionState, useRef, useState, useTransition } from "react"
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"

import { useActionStateToast } from "@/components/shared/action-state-toast"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  createDeliverySessionAction,
  deleteScheduleRowAction,
  uploadScheduleFileAction,
} from "@/features/delivery-verification/actions"
import {
  type DeliverySession,
  initialUploadScheduleState,
} from "@/features/delivery-verification/form-state"

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  })
}

/**
 * Tombol "Tambah Session" tidak meminta isian apa pun: session langsung jadi
 * dengan nomor urut dan tanggal, dan sisanya diisi dari file jadwalnya.
 */
function AddSessionButton() {
  const [isPending, startTransition] = useTransition()
  const [state, setState] = useState(initialUploadScheduleState)
  useActionStateToast(state)

  return (
    <Button
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          setState(await createDeliverySessionAction())
        })
      }
      type="button"
    >
      {isPending ? <Spinner /> : <PlusIcon data-icon="inline-start" />}
      Tambah Session
    </Button>
  )
}

/**
 * Upload jadwal. Formnya mengirim sendiri begitu file dipilih -- langkah
 * "pilih file" lalu "tekan Unggah" tidak menambah keputusan apa pun bagi
 * operator, hanya satu klik yang mudah terlupa di lantai produksi.
 */
function ScheduleUpload({ sessionId }: { sessionId: string }) {
  const [state, formAction, isPending] = useActionState(
    uploadScheduleFileAction,
    initialUploadScheduleState,
  )
  useActionStateToast(state)
  const formRef = useRef<HTMLFormElement>(null)

  return (
    <form action={formAction} ref={formRef}>
      <input name="sessionId" type="hidden" value={sessionId} />
      <Button asChild disabled={isPending} size="sm" variant="secondary">
        <label>
          {isPending ? <Spinner /> : <UploadIcon data-icon="inline-start" />}
          Upload jadwal
          <input
            accept=".xlsx,.xls,.pdf"
            className="sr-only"
            disabled={isPending}
            name="file"
            onChange={() => formRef.current?.requestSubmit()}
            type="file"
          />
        </label>
      </Button>
    </form>
  )
}

function DeleteRowButton({ rowId }: { rowId: string }) {
  const [isPending, startTransition] = useTransition()
  const [state, setState] = useState(initialUploadScheduleState)
  useActionStateToast(state)

  return (
    <Button
      aria-label="Hapus baris jadwal"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          setState(await deleteScheduleRowAction(rowId))
        })
      }
      size="icon"
      type="button"
      variant="ghost"
    >
      {isPending ? <Spinner /> : <Trash2Icon />}
    </Button>
  )
}

function ScheduleTable({ session }: { session: DeliverySession }) {
  if (session.rows.length === 0) {
    return (
      <Empty className="border-none">
        <EmptyTitle>Belum ada jadwal</EmptyTitle>
        <EmptyDescription>
          Unggah file Excel berisi kolom Part No dan Qty. File berikutnya
          menambah baris di bawahnya.
        </EmptyDescription>
      </Empty>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Part No</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead>Asal file</TableHead>
            <TableHead className="w-24 text-center">Verifikasi</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {session.rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="tabular-nums">{row.rowNo}</TableCell>
              <TableCell className="font-medium">{row.partNo}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.qty}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {row.sourceFileName}
              </TableCell>
              <TableCell className="text-center">
                {/* Centang hijau diisi Bagian 2. Sampai itu ada, tiap baris
                    berdiri sebagai lingkaran kosong supaya kolomnya sudah
                    terbaca sebagai daftar pekerjaan yang belum selesai. */}
                {row.verifiedAt ? (
                  <CheckCircle2Icon className="text-success mx-auto size-5" />
                ) : (
                  <CircleDashedIcon className="text-muted-foreground mx-auto size-5" />
                )}
              </TableCell>
              <TableCell>
                {row.verifiedAt ? null : <DeleteRowButton rowId={row.id} />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function DeliverySessionWorkspace({
  sessions,
}: {
  sessions: DeliverySession[]
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Verifikasi Pengiriman</h1>
          <p className="text-muted-foreground text-sm">
            Satu session per kiriman: isi Schedule Delivery dari file, lalu
            cocokkan tiap label box dengan scan QR.
          </p>
        </div>
        <AddSessionButton />
      </div>

      {sessions.length === 0 ? (
        <Empty>
          <EmptyTitle>Belum ada session</EmptyTitle>
          <EmptyDescription>
            Tekan Tambah Session untuk memulai verifikasi satu kiriman.
          </EmptyDescription>
        </Empty>
      ) : (
        sessions.map((session) => {
          const verified = session.rows.filter((row) => row.verifiedAt).length

          return (
            <section
              className="bg-background flex flex-col gap-4 rounded-xl border p-5"
              key={session.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-semibold">
                    Session {session.sessionNo}
                  </h2>
                  <Badge
                    variant={
                      session.status === "done" ? "default" : "secondary"
                    }
                  >
                    {session.status === "done" ? "Selesai" : "Berjalan"}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {formatDateTime(session.createdAt)}
                  </span>
                  {session.rows.length > 0 ? (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {verified}/{session.rows.length} terverifikasi
                    </span>
                  ) : null}
                </div>
                {session.status === "open" ? (
                  <ScheduleUpload sessionId={session.id} />
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Schedule Delivery</h3>
                <ScheduleTable session={session} />
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}
