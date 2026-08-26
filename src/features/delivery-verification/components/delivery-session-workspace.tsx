"use client"

import {
  useActionState,
  useCallback,
  useRef,
  useState,
  useTransition,
} from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleDashedIcon,
  PlusIcon,
  ScanLineIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UploadIcon,
  XCircleIcon,
} from "lucide-react"

import { useActionStateToast } from "@/components/shared/action-state-toast"
import { cn } from "@/lib/utils"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
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
  deleteDeliverySessionAction,
  deleteScheduleRowAction,
  uploadScheduleFileAction,
  verifyDeliveryLabelAction,
} from "@/features/delivery-verification/actions"
import {
  type DeliveryScanResult,
  type DeliverySession,
  initialUploadScheduleState,
} from "@/features/delivery-verification/form-state"
import { useScannerListener } from "@/features/scan/use-scanner-listener"

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

/**
 * Menghapus satu session. Konfirmasinya menyebut angka yang ikut hilang, bukan
 * "tindakan ini permanen" belaka: yang terbuang bersama sessionnya adalah
 * seluruh bukti pemeriksaan kiriman itu, dan besarnya baru terasa kalau
 * disebutkan.
 */
function DeleteSessionButton({ session }: { session: DeliverySession }) {
  const [isPending, startTransition] = useTransition()
  const [state, setState] = useState(initialUploadScheduleState)
  const [open, setOpen] = useState(false)
  useActionStateToast(state)

  const verified = session.rows.filter((row) => row.verifiedAt).length

  return (
    <AlertDialog onOpenChange={setOpen} open={open}>
      <AlertDialogTrigger asChild>
        <Button
          aria-label={`Hapus Session ${session.sessionNo}`}
          size="icon"
          variant="ghost"
        >
          <Trash2Icon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Hapus Session {session.sessionNo}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {session.rows.length === 0
              ? "Session ini belum berisi jadwal apa pun."
              : `${session.rows.length} baris jadwal ikut terhapus, termasuk ${verified} yang sudah PASS, beserta seluruh catatan scannya.`}{" "}
            Tindakan ini permanen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <Button
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteDeliverySessionAction(session.id)
                setState(result)
                if (result.success) setOpen(false)
              })
            }
            type="button"
            variant="destructive"
          >
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Hapus
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
            {/* "Qty per Box" adalah nama yang dipakai operator untuk angka
                yang tercetak di baris Qty/Delivery label -- field ketiga QR
                sejak 20260821083835. Bukan Qty/Box milik Master Item, yang
                nilainya sama untuk setiap kiriman dan tidak pernah berubah. */}
            <TableHead className="text-right">Qty per Box</TableHead>
            <TableHead>Label</TableHead>
            <TableHead>Asal file</TableHead>
            <TableHead className="w-24 text-center">Verifikasi</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {session.rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="tabular-nums">{row.rowNo}</TableCell>
              <TableCell className="font-medium">{row.productSize}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.qty}
              </TableCell>
              <TableCell>
                {/* Baris yang labelnya belum pernah dibuat ditandai sejak
                    upload, bukan didiamkan sampai scan. Ia masih bisa PASS
                    nanti kalau labelnya dicetak menyusul -- yang ditandai di
                    sini keadaan sekarang, bukan vonis. */}
                {row.matchingBatchExists ? (
                  <span className="text-muted-foreground text-xs">
                    Tersedia
                  </span>
                ) : (
                  <span className="text-warning flex items-center gap-1.5 text-xs">
                    <TriangleAlertIcon className="size-3.5 shrink-0" />
                    Belum ada
                  </span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {row.sourceFileName}
              </TableCell>
              <TableCell className="text-center">
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

/**
 * Bagian 2. Scanner adalah keyboard wedge, jadi tidak ada field yang diketik:
 * pendengarnya menangkap ketikan di halaman dan mengirim satu baris per Enter.
 *
 * Hanya satu session yang boleh mendengarkan sekaligus. Dua session terbuka
 * yang sama-sama menerima scan akan membuat satu label masuk ke jadwal yang
 * salah tanpa cara mengetahuinya.
 */
function VerificationPanel({
  active,
  onToggle,
  session,
}: {
  active: boolean
  onToggle: () => void
  session: DeliverySession
}) {
  const router = useRouter()

  const handleScan = useCallback(
    async (rawPayload: string) => {
      let result: DeliveryScanResult

      try {
        result = await verifyDeliveryLabelAction({
          qrPayload: rawPayload,
          sessionId: session.id,
        })
      } catch (thrown) {
        // Beda dari NOT PASS: ini panggilannya sendiri yang gagal total --
        // jaringan putus, atau server action-nya sudah tidak sinkron dengan
        // build yang sedang dipakai browser setelah kode diubah. Tanpa
        // penangkapan ini kegagalan seperti itu membisu -- scanner-listener.ts
        // menangkapnya lagi di lapisan bawah tapi tidak pernah menampilkan
        // toast -- dan operator mengira scannya tidak terbaca sama sekali.
        console.error("verifyDeliveryLabelAction gagal:", thrown)
        const message =
          "Scan gagal diproses karena kesalahan tak terduga. Coba lagi; kalau berulang, muat ulang halaman."
        toast.error(message)
        return { message, status: "error" as const }
      }

      if (result.outcome === "pass") {
        toast.success(result.message)
        // DELIVERY OK berdiri sendiri sesudah PASS-nya, bukan menggantikannya:
        // yang terakhir tetap perlu tahu labelnya diterima.
        if (result.deliveryOk) {
          toast.success(`DELIVERY OK — Session ${session.sessionNo} selesai.`)
        }
      } else {
        toast.error(result.message)
      }

      router.refresh()

      return {
        message: result.message,
        status:
          result.outcome === "pass"
            ? ("success" as const)
            : result.outcome === "duplicate_label"
              ? ("duplicate" as const)
              : ("error" as const),
      }
    },
    [router, session.id, session.sessionNo],
  )

  const { lastRawPayload, lastScan, pending } = useScannerListener({
    enabled: active,
    onScan: handleScan,
  })

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {/* Titik berdenyut adalah satu-satunya penanda yang masih terlihat
            sambil operator menunduk memegang scanner, bukan menatap layar:
            warna tombolnya sendiri baru terbaca kalau matanya sudah di sana. */}
        {active ? (
          <span className="relative flex size-2.5">
            <span
              className={cn(
                "absolute inline-flex h-full w-full rounded-full opacity-75",
                pending
                  ? "bg-muted-foreground animate-pulse"
                  : "bg-success animate-ping",
              )}
            />
            <span
              className={cn(
                "relative inline-flex size-2.5 rounded-full",
                pending ? "bg-muted-foreground" : "bg-success",
              )}
            />
          </span>
        ) : null}
        <Button
          onClick={(event) => {
            // Fokus dilepas dari tombolnya. Scanner mengetik ke elemen yang
            // sedang terfokus, dan tombol yang terfokus bereaksi terhadap spasi
            // maupun Enter di tengah payload. Pendengarnya sudah menahan
            // keduanya, tapi membiarkan fokus di sini berarti bertumpu pada
            // penahanan itu saja -- padahal cukup dilepaskan.
            event.currentTarget.blur()
            onToggle()
          }}
          size="sm"
          type="button"
          variant={active ? "default" : "outline"}
        >
          {pending ? <Spinner /> : <ScanLineIcon data-icon="inline-start" />}
          {active ? "Scan aktif" : "Mulai scan"}
        </Button>
      </div>
      {/* Payload mentah terakhir. Ia menjawab pertanyaan yang tidak bisa
          dijawab pesan hasil: apakah ketikan scanner sampai ke halaman ini
          sama sekali. Kosong setelah ditembak berarti masalahnya di scanner
          atau fokus jendela, bukan di pencocokan. */}
      {active ? (
        <p className="text-muted-foreground max-w-64 text-right font-mono text-[0.65rem] break-all">
          {lastRawPayload ?? "Belum ada QR terbaca"}
        </p>
      ) : null}
      {/* Hasil scan terakhir bertahan di layar, bukan cuma lewat lewat sebagai
          toast: toast bisa terlewat waktu operator sedang menempel label,
          sementara baris ini tetap terbaca begitu ia menoleh ke layar lagi. */}
      {active && lastScan ? (
        <p
          className={cn(
            "flex max-w-64 items-center gap-1.5 text-right text-xs",
            lastScan.status === "success" ? "text-success" : "text-destructive",
          )}
        >
          {lastScan.status === "success" ? (
            <CheckCircle2Icon className="size-3.5 shrink-0" />
          ) : (
            <XCircleIcon className="size-3.5 shrink-0" />
          )}
          {lastScan.message ?? lastScan.rawPayload}
        </p>
      ) : null}
    </div>
  )
}

export function DeliverySessionWorkspace({
  sessions,
}: {
  sessions: DeliverySession[]
}) {
  const [scanningSessionId, setScanningSessionId] = useState<string | null>(
    null,
  )

  /**
   * Session yang sudah selesai terlipat sendiri; yang masih berjalan terbuka.
   * Bawaan itu dipatok sekali saat sessionnya pertama kali terlihat -- bukan
   * dihitung ulang dari session.status yang sedang berjalan tiap render. Scan
   * terakhir yang melunasi sebuah session mengubah status-nya jadi 'done' di
   * RPC yang sama, dan menghitung ulang dari status itu berarti kartunya
   * menutup diri sendiri tepat pada render yang sama saat operator baru
   * melihat hasilnya -- persis yang dilaporkan sebagai "mode scan langsung
   * off".
   *
   * Dipatok lewat pola "menyesuaikan state saat prop berubah" dari React --
   * memanggil setState langsung di badan render, dijaga kondisi -- bukan
   * lewat ref yang dibaca langsung saat render (melanggar react-hooks/refs,
   * karena render harus murni) maupun lewat useEffect (React sendiri
   * menganjurkan menghindarinya untuk penyesuaian macam ini: satu putaran
   * render tambahan yang terlihat, alih-alih ditangani React sebelum commit).
   *
   * `toggled` menyimpan hanya penyimpangan dari bawaan itu, bukan keadaan
   * tiap session, supaya session baru yang datang setelah halaman dimuat
   * tetap mengikuti bawaannya sendiri tanpa perlu didaftarkan lebih dulu.
   */
  const [defaultExpandedById, setDefaultExpandedById] = useState<
    Map<string, boolean>
  >(new Map())
  const [toggled, setToggled] = useState<Set<string>>(new Set())

  const unseenSession = sessions.find(
    (session) => !defaultExpandedById.has(session.id),
  )
  if (unseenSession) {
    const next = new Map(defaultExpandedById)
    for (const session of sessions) {
      if (!next.has(session.id)) {
        next.set(session.id, session.status === "open")
      }
    }
    setDefaultExpandedById(next)
  }

  const toggleExpanded = (sessionId: string) => {
    setToggled((current) => {
      const next = new Set(current)
      if (next.has(sessionId)) next.delete(sessionId)
      else next.add(sessionId)
      return next
    })

    // Menutup session yang sedang mendengarkan scan sekaligus mematikan
    // pendengarnya: scan yang masuk ke jadwal yang tidak terlihat tidak bisa
    // diperiksa operator.
    setScanningSessionId((current) => (current === sessionId ? null : current))
  }

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
          const withoutLabel = session.rows.filter(
            (row) => !row.matchingBatchExists,
          ).length
          const defaultExpanded =
            defaultExpandedById.get(session.id) ?? session.status === "open"
          const expanded = toggled.has(session.id)
            ? !defaultExpanded
            : defaultExpanded

          const scanning = scanningSessionId === session.id

          return (
            <section
              className={cn(
                "bg-background flex flex-col gap-4 rounded-xl border p-5",
                // Cincin di sekeliling kartu, bukan cuma warna tombolnya:
                // dengan beberapa session terbuka sekaligus, ini yang
                // menjawab "yang mana sedang menerima scan" dari kejauhan.
                scanning && "ring-success/50 ring-2",
              )}
              key={session.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  {/* Judulnya sendiri yang jadi tombol buka-tutup: sasaran
                      klik terbesar di baris ini, dan operator memakai layar
                      sentuh di lantai produksi. */}
                  <button
                    aria-expanded={expanded}
                    className="focus-visible:ring-ring flex items-center gap-2 rounded-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                    onClick={() => toggleExpanded(session.id)}
                    type="button"
                  >
                    <ChevronDownIcon
                      className={`size-4 transition-transform ${
                        expanded ? "" : "-rotate-90"
                      }`}
                    />
                    <h2 className="text-lg font-semibold">
                      Session {session.sessionNo}
                    </h2>
                  </button>
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
                  {withoutLabel > 0 ? (
                    <span className="text-warning text-xs">
                      {withoutLabel} belum ada labelnya
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Upload dan scan ikut tersembunyi saat ditutup. Tombol yang
                      mengubah isi session tidak boleh bisa ditekan sementara
                      isinya tidak kelihatan. */}
                  {expanded && session.status === "open" ? (
                    <>
                      <ScheduleUpload sessionId={session.id} />
                      {session.rows.length > 0 ? (
                        <VerificationPanel
                          active={scanningSessionId === session.id}
                          onToggle={() =>
                            setScanningSessionId((current) =>
                              current === session.id ? null : session.id,
                            )
                          }
                          session={session}
                        />
                      ) : null}
                    </>
                  ) : null}
                  <DeleteSessionButton session={session} />
                </div>
              </div>

              {expanded ? (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium">Schedule Delivery</h3>
                  <ScheduleTable session={session} />
                </div>
              ) : null}
            </section>
          )
        })
      )}
    </div>
  )
}
