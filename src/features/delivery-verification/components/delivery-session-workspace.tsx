"use client"

import {
  useActionState,
  useCallback,
  useEffect,
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
import { Input } from "@/components/ui/input"
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

/** Jarak antar tombol scanner beberapa milidetik; 180 ms sudah jauh di atasnya. */
const AUTO_SUBMIT_IDLE_MS = 180

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

/**
 * DO Date datang sebagai `YYYY-MM-DD` tanpa zona waktu. Ia dibaca sebagai
 * tanggal setempat, bukan lewat `new Date(...)` yang menganggapnya UTC dan
 * memundurkannya sehari di zona timur.
 */
function formatDoDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number)
  return new Date(year, month - 1, day).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * Nilai kolom dokumen yang diringkas untuk kepala kartu. Satu DO Report boleh
 * memuat beberapa tanggal dan beberapa customer sekaligus; menampilkan
 * semuanya membuat barisnya melebar tak keruan, sementara menampilkan yang
 * pertama saja diam-diam menyembunyikan bahwa ada yang lain.
 */
function summarise(values: (string | null)[]): string | null {
  const unique = [
    ...new Set(values.filter((value): value is string => !!value)),
  ]
  if (unique.length === 0) return null
  if (unique.length <= 2) return unique.join(", ")
  return `${unique[0]} +${unique.length - 1} lagi`
}

type SessionProgress = "belum" | "berjalan" | "selesai"

/**
 * Warnanya diminta tegas, bukan halus: kartu ini dibaca sekilas dari jarak
 * lantai produksi, dan yang perlu langsung terbaca adalah mana yang belum
 * disentuh sama sekali.
 */
function StatusBadge({ status }: { status: SessionProgress }) {
  const style = {
    belum: { className: "bg-red-600 text-white", label: "Belum berjalan" },
    berjalan: { className: "bg-yellow-400 text-black", label: "Berjalan" },
    selesai: { className: "bg-blue-600 text-white", label: "Selesai" },
  }[status]

  return (
    <Badge className={cn("border-transparent", style.className)}>
      {style.label}
    </Badge>
  )
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
        {/* Bulat hitam berikon putih. Ia berdiri di sisi kanan bersama tanggal
            session, jauh dari tombol yang dipakai sehari-hari, dan bentuknya
            sendiri yang membedakannya dari keduanya. */}
        <Button
          aria-label={`Hapus Session ${session.sessionNo}`}
          className="size-9 rounded-full bg-black text-white hover:bg-black/80"
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
          Unggah DO Report — yang dibaca kolom Customer, Item No, dan Qty. Hanya
          baris berdivisi sheet yang masuk; tube dan kabel dilewati. File
          berikutnya menambah baris di bawahnya.
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
            {/* Satu DO Report memuat beberapa customer sekaligus, jadi kolom
                ini yang menjawab kiriman siapa yang sedang diperiksa. */}
            <TableHead>Customer</TableHead>
            <TableHead>Part No</TableHead>
            {/* Qty Delivery adalah seluruh kiriman untuk ukuran ini, bukan isi
                satu box. Sebelum 20260828025319 kolom ini bernama "Qty per
                Box" dan satu baris lunas oleh satu label -- nama itu ikut
                berganti supaya angkanya tidak terbaca sebagai isi box. */}
            <TableHead className="text-right">Qty Delivery</TableHead>
            {/* Keping yang sudah masuk dari yang dijadwalkan. Ini yang
                menentukan lunas, dan satu-satunya angka yang tidak bisa
                dihitung operator sendiri sambil membongkar palet. */}
            <TableHead className="text-right">Terscan</TableHead>
            {/* Keterangan belaka: berapa box yang dipakai tidak diatur, jadi
                angka ini tidak punya target untuk dibandingkan. */}
            <TableHead className="w-16 text-center">Box</TableHead>
            <TableHead>Asal file</TableHead>
            <TableHead className="w-24 text-center">Verifikasi</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {session.rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="tabular-nums">{row.rowNo}</TableCell>
              {/* Seluruh isi tabel memakai warna teks penuh, bukan abu-abu
                  peredup: ini dibaca dari jarak pandang lantai produksi sambil
                  operator memegang scanner, bukan dari depan meja. */}
              <TableCell className="text-foreground text-xs">
                {row.customer ?? "—"}
              </TableCell>
              <TableCell className="font-medium">{row.productSize}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.qtyDelivery}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.verifiedQty}
              </TableCell>
              <TableCell className="text-center tabular-nums">
                {row.verifiedBoxes}
              </TableCell>
              <TableCell className="text-foreground text-xs">
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
 * Bagian 2. Scanner adalah keyboard wedge: ia mengetik ke elemen yang sedang
 * terfokus, dan halaman ini menangkapnya lewat dua jalur sekaligus -- kotak
 * scan yang terfokus sendiri, dan pendengar global untuk ketikan yang mendarat
 * di badan halaman. Pendengar global mengabaikan input, jadi satu tembakan
 * tidak pernah terkirim dua kali.
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
  const [manualPayload, setManualPayload] = useState("")
  // Scanner mengetik ke jendela yang sedang fokus. Kalau fokusnya di jendela
  // lain, scan hilang tanpa jejak, jadi keadaan itu harus terlihat.
  const [pageFocused, setPageFocused] = useState(true)
  const scanInputRef = useRef<HTMLInputElement | null>(null)
  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const sync = () => setPageFocused(document.hasFocus())
    sync()
    window.addEventListener("blur", sync)
    window.addEventListener("focus", sync)

    return () => {
      window.removeEventListener("blur", sync)
      window.removeEventListener("focus", sync)
    }
  }, [])

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
          toast.success(`DELIVERY OK. SESSION ${session.sessionNo} SELESAI`)
        }
      } else {
        toast.error(result.message)
      }

      router.refresh()

      return {
        message: result.message,
        status:
          result.outcome === "pass" ? ("success" as const) : ("error" as const),
      }
    },
    [router, session.id, session.sessionNo],
  )

  const { lastRawPayload, lastScan, pending, submit } = useScannerListener({
    enabled: active,
    onScan: handleScan,
  })

  const submitPayload = useCallback(
    async (rawPayload: string) => {
      const payload = rawPayload.trim()
      if (!payload) return

      if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current)
      setManualPayload("")
      scanInputRef.current?.focus()
      await submit(payload)
    },
    [submit],
  )

  /**
   * Scanner mengetik seluruh payload dalam puluhan milidetik. Diam sebentar
   * setelah ketikan terakhir berarti tembakan sudah selesai, jadi scan dikirim
   * sendiri dan operator tidak perlu menekan apa pun.
   *
   * Ini bukan kenyamanan melainkan syarat: DS2208 di lantai produksi tidak
   * dipasangi sufiks apa pun -- tidak Enter, tidak Tab -- jadi menunggu Enter
   * berarti buffernya menumpuk selamanya dan halaman ini membisu total, jenis
   * kegagalan yang paling mahal karena tidak meninggalkan satu pun pesan.
   * Enter dari scanner tetap mengirim seketika kalau suatu saat dipasang, dan
   * pengetikan manual masih sempat selesai karena jedanya lebih panjang dari
   * jarak antar tombol scanner.
   */
  const onScanInputChange = useCallback(
    (value: string) => {
      setManualPayload(value)
      if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current)
      if (!value.trim()) return

      autoSubmitTimer.current = setTimeout(() => {
        void submitPayload(value)
      }, AUTO_SUBMIT_IDLE_MS)
    },
    [submitPayload],
  )

  useEffect(
    () => () => {
      if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current)
    },
    [],
  )

  // Kotak scan mengambil fokus begitu mode scan menyala. Tanpa ini operator
  // harus mengkliknya lebih dulu, dan tembakan pertama -- yang justru paling
  // mungkin ditembak sambil menunduk -- hilang ke badan halaman.
  useEffect(() => {
    if (active) scanInputRef.current?.focus()
  }, [active])

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        active ? "w-full items-stretch" : "items-end",
      )}
    >
      <div className="flex items-center gap-2 self-end">
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
      {/* Kotak scan menangkap ketikan scanner langsung, tanpa bergantung pada
          fokus yang kebetulan mendarat di badan halaman. Isinya terlihat
          sehingga operator tahu tombolnya sampai atau tidak. */}
      {active ? (
        <div className="mt-1 flex flex-col gap-1.5 rounded-lg border p-3">
          <label
            className="text-sm font-medium"
            htmlFor={`scan-input-${session.id}`}
          >
            Kotak scan
          </label>
          <Input
            autoComplete="off"
            className="font-mono"
            id={`scan-input-${session.id}`}
            onChange={(event) => onScanInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              event.preventDefault()
              void submitPayload(manualPayload)
            }}
            placeholder="Arahkan scanner ke sini lalu tembak QR"
            ref={scanInputRef}
            value={manualPayload}
          />
          {pageFocused ? (
            <p className="text-muted-foreground text-xs">
              Kotak ini terfokus sendiri dan mengirim otomatis. Kalau ditembak
              dan tetap kosong, tombol scanner tidak sampai ke jendela ini.
            </p>
          ) : (
            <p className="text-destructive flex items-center gap-1.5 text-xs">
              <TriangleAlertIcon className="size-3.5 shrink-0" />
              Halaman tidak fokus — scanner mengetik ke jendela yang sedang
              fokus. Klik halaman ini dulu.
            </p>
          )}
          {/* Payload mentah terakhir. Ia menjawab pertanyaan yang tidak bisa
              dijawab pesan hasil: apakah ketikan scanner sampai ke halaman ini
              sama sekali. Kosong setelah ditembak berarti masalahnya di
              scanner atau fokus jendela, bukan di pencocokan. */}
          <p className="text-muted-foreground font-mono text-[0.65rem] break-all">
            {lastRawPayload ?? "Belum ada QR terbaca"}
          </p>
        </div>
      ) : null}
      {/* Hasil scan terakhir bertahan di layar, bukan cuma lewat lewat sebagai
          toast: toast bisa terlewat waktu operator sedang menempel label,
          sementara baris ini tetap terbaca begitu ia menoleh ke layar lagi. */}
      {active && lastScan ? (
        <p
          className={cn(
            "flex items-center gap-1.5 text-xs",
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
          // Yang dihitung keping, bukan baris maupun box: berapa box yang
          // dipakai tidak diatur, jadi "8/12 box" tidak menjawab apa pun
          // tentang kemajuan kiriman.
          const verifiedQty = session.rows.reduce(
            (total, row) => total + row.verifiedQty,
            0,
          )
          const totalQty = session.rows.reduce(
            (total, row) => total + row.qtyDelivery,
            0,
          )
          // Jadwal kosong bukan kiriman yang lunas. Tanpa syarat panjangnya,
          // session yang belum diisi file apa pun akan mengaku DELIVERY OK
          // sebelum satu pun kiriman diperiksa.
          const deliveryOk =
            session.rows.length > 0 &&
            session.rows.every((row) => row.verifiedAt)
          const doDates = summarise(
            session.rows.map((row) =>
              row.doDate ? formatDoDate(row.doDate) : null,
            ),
          )
          const customers = summarise(session.rows.map((row) => row.customer))
          // Tiga keadaan, bukan dua. "Berjalan" untuk session yang sudah
          // menerima scan; yang belum disentuh sama sekali berdiri sendiri,
          // sebab itulah yang menunggu dikerjakan.
          const progress: SessionProgress =
            session.status === "done"
              ? "selesai"
              : verifiedQty > 0
                ? "berjalan"
                : "belum"
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
                  <StatusBadge status={progress} />
                  {/* Tanggal DO dan customer datang dari dokumennya, bukan dari
                      aplikasi: itu yang menjawab "kiriman mana ini" tanpa
                      membuka tabelnya. Satu file boleh memuat beberapa, jadi
                      keduanya diringkas. */}
                  {doDates ? (
                    <span className="text-foreground text-xs font-bold">
                      DO {doDates}
                    </span>
                  ) : null}
                  {customers ? (
                    <span className="text-foreground text-xs font-bold">
                      {customers}
                    </span>
                  ) : null}
                  {/* DELIVERY OK bertahan di kartu, bukan cuma lewat sebagai
                      toast pada scan terakhir. Toast itu hilang dalam hitungan
                      detik dan hanya terlihat oleh yang sedang memegang
                      scanner; pertanyaan "kiriman ini sudah lunas belum?"
                      datang lagi nanti, dari orang lain, di depan daftar
                      session yang seluruhnya terlipat.

                      Diturunkan dari barisnya sendiri, bukan dari status:
                      status berubah di RPC dan baru sampai ke layar setelah
                      refresh, sedangkan yang ditanya operator adalah apa yang
                      ia lihat di tabel. */}
                  {deliveryOk ? (
                    <span className="text-success flex items-center gap-1.5 text-xs font-semibold">
                      <CheckCircle2Icon className="size-4 shrink-0" />
                      DELIVERY OK
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-3">
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
                  {/* Kemajuan dan waktu session dibuat berdiri sebaris dengan
                      judul tabelnya: keduanya menerangkan isi tabel di
                      bawahnya, bukan kiriman yang disebut di kepala kartu. */}
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <h3 className="text-sm font-medium">Schedule Delivery</h3>
                    <div className="flex flex-wrap items-end gap-3">
                      {session.rows.length > 0 ? (
                        <span className="text-foreground text-xs tabular-nums">
                          {verifiedQty}/{totalQty} pcs terverifikasi
                        </span>
                      ) : null}
                      <span className="text-foreground text-right text-xs">
                        {formatDate(session.createdAt)}
                        <br />
                        {formatTime(session.createdAt)}
                      </span>
                    </div>
                  </div>
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
