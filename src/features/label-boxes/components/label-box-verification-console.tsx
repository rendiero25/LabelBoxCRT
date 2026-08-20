"use client"

import { useActionState, useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  Loader2Icon,
  type LucideIcon,
  PackageCheckIcon,
  ScanLineIcon,
  Volume2Icon,
  VolumeOffIcon,
  XCircleIcon,
} from "lucide-react"
import Link from "next/link"

import {
  acceptLabelBoxScanAction,
  closeLabelBoxBatchAction,
} from "@/features/label-boxes/verification-actions"
import { initialCloseLabelBoxBatchActionState } from "@/features/label-boxes/verification-form-state"
import { LabelBoxBatchPrintCard } from "@/features/label-boxes/components/label-box-batch-print-card"
import { shortenLayerName } from "@/features/master-items/layer-label"
import { formatProductPreview } from "@/features/products/validation"
import { useScannerListener } from "@/features/scan/use-scanner-listener"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

export type VerificationLayerProduct = {
  acceptedQty: number
  expectedQty: number
  id: string
  innerDiameter: number
  length: number
  outerDiameter: number
  partName: string
  productCode: string
}

export type VerificationBoxLayer = {
  id: string
  layerName: string
  layerNo: number
  products: VerificationLayerProduct[]
}

/** Satu label box: satu box fisik pada satu set, dengan kuota layernya sendiri. */
export type VerificationSetBox = {
  acceptedQty: number
  boxName: string
  boxNumber: string
  expectedQty: number
  id: string
  layers: VerificationBoxLayer[]
  verified: boolean
}

/**
 * Satu set label, yaitu satu putaran pengepakan seluruh box Master Item. Qty
 * Delivery dibagi Packing Qty menentukan jumlahnya: qty 200 dengan packing qty
 * 100 dan 3 box berarti dua set, dan tiap set discan sampai penuh sendiri.
 * Sebelumnya penggandaan ini disembunyikan, sehingga operator mengira 3 box
 * yang tampil di panel sudah mewakili seluruh pekerjaannya.
 */
export type VerificationSet = {
  boxes: VerificationSetBox[]
  setNo: number
}

export type VerificationBatchView = {
  deliveryDate: string
  deliveryNumber: string
  id: string
  /** Seluruh label batch ini sudah pernah terkirim ke printer. */
  labelsPrinted: boolean
  lotNo: string
  partNo: string
  qtyDelivery: number
  sets: VerificationSet[]
  supplierCode: string
}

/** Jarak antar tombol scanner beberapa milidetik; 180 ms sudah jauh di atasnya. */
const AUTO_SUBMIT_IDLE_MS = 180

type ScanStateTone = "busy" | "danger" | "idle" | "success"

type ScanState = {
  Icon: LucideIcon
  description: string
  title: string
  tone: ScanStateTone
}

/**
 * Satu keadaan banner scan, dihitung sekali. Judul, kalimat, ikon, dan warna
 * dulu ditentukan tiga rantai ternary terpisah yang harus dibaca sejajar untuk
 * tahu tampilannya; satu cabang saja meleset dan ikon bisa bercerita lain
 * dari judulnya.
 */
function resolveScanState({
  activeBoxNumber,
  lastScan,
  pageFocused,
  pending,
}: {
  activeBoxNumber: string | null
  lastScan: {
    message?: string
    status: "duplicate" | "error" | "success"
  } | null
  pageFocused: boolean
  pending: boolean
}): ScanState {
  if (pending) {
    return {
      Icon: Loader2Icon,
      description: "Menunggu jawaban server.",
      title: "Memproses scan",
      tone: "busy",
    }
  }

  if (!pageFocused) {
    return {
      Icon: CircleAlertIcon,
      description:
        "Scanner mengetik ke jendela yang sedang fokus. Klik halaman ini dulu.",
      title: "Halaman tidak fokus",
      tone: "danger",
    }
  }

  if (lastScan?.status === "success") {
    return {
      Icon: CircleCheckIcon,
      description: lastScan.message ?? "Lanjut ke produk berikutnya.",
      title: "Scan diterima",
      tone: "success",
    }
  }

  if (lastScan?.status === "duplicate" || lastScan?.status === "error") {
    return {
      Icon: CircleAlertIcon,
      description: lastScan.message ?? "Coba scan ulang.",
      title:
        lastScan.status === "duplicate" ? "Label duplikat" : "Scan ditolak",
      tone: "danger",
    }
  }

  return {
    Icon: ScanLineIcon,
    description: activeBoxNumber
      ? `Box aktif ${activeBoxNumber}. Tembak QR produk kapan saja.`
      : "Semua box sudah penuh. Cetak labelnya, lalu simpan batch.",
    title: "Scanner siap",
    tone: "idle",
  }
}

function percentage(acceptedQty: number, expectedQty: number): number {
  if (expectedQty <= 0) return 0
  return Math.min(100, Math.round((acceptedQty / expectedQty) * 100))
}

function playScanTone(
  status: "duplicate" | "error" | "success",
  muted: boolean,
) {
  if (muted || typeof window === "undefined") return

  try {
    const context = new AudioContext()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = "sine"
    oscillator.frequency.value = status === "success" ? 880 : 220
    gain.gain.setValueAtTime(0.06, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.12)
    oscillator.addEventListener("ended", () => void context.close())
  } catch {
    // Sebagian browser menahan audio sebelum ada gestur pengguna. Tampilan
    // visualnya tetap memberi tahu hasil scan.
  }
}

export function LabelBoxVerificationConsole({
  batch,
}: {
  batch: VerificationBatchView
}) {
  const router = useRouter()
  const [closeState, closeAction, closePending] = useActionState(
    closeLabelBoxBatchAction,
    initialCloseLabelBoxBatchActionState,
  )
  useActionStateToast(closeState)

  const [muted, setMuted] = useState(false)
  // Scanner mengetik ke jendela yang sedang fokus. Kalau fokus pindah ke
  // jendela lain, scan hilang tanpa jejak, jadi keadaan itu harus terlihat.
  const [pageFocused, setPageFocused] = useState(true)
  const [manualPayload, setManualPayload] = useState("")
  // Batch ditutup setelah labelnya keluar, bukan sebelumnya: menutup lebih dulu
  // membuat operator menyimpan batch tanpa tahu cetakannya berhasil.
  // Keadaan awal datang dari database, bukan dari nol: tab yang tertutup
  // setelah mencetak tidak boleh mengunci penyelesaian batch.
  const [printedThisSession, setPrintedThisSession] = useState(false)
  const printed = batch.labelsPrinted || printedThisSession
  const scanInputRef = useRef<HTMLInputElement | null>(null)
  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playedScanAt = useRef<number | null>(null)

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

  const onScan = useCallback(
    async (rawPayload: string) => {
      const result = await acceptLabelBoxScanAction({
        batchId: batch.id,
        rawPayload,
      })
      if (result.status === "success") router.refresh()
      return { message: result.message, status: result.status }
    },
    [batch.id, router],
  )

  const scanner = useScannerListener({ enabled: true, onScan })

  const submitPayload = useCallback(
    async (rawPayload: string) => {
      const payload = rawPayload.trim()
      if (!payload) return

      if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current)
      setManualPayload("")
      scanInputRef.current?.focus()
      await scanner.submit(payload)
    },
    [scanner],
  )

  /**
   * Scanner mengetik seluruh payload dalam puluhan milidetik. Diam sebentar
   * setelah ketikan terakhir berarti tembakan sudah selesai, jadi scan dikirim
   * sendiri dan operator tidak perlu menekan apa pun. Enter dari scanner tetap
   * mengirim seketika, dan pengetikan manual masih sempat selesai karena
   * jedanya lebih panjang dari jarak antar tombol scanner.
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

  useEffect(() => {
    const scan = scanner.lastScan
    if (!scan || playedScanAt.current === scan.scannedAt.getTime()) return

    playedScanAt.current = scan.scannedAt.getTime()
    playScanTone(scan.status, muted)

    // Scan ditolak tidak boleh tergeser scan berikutnya: tahan sampai
    // operator menutupnya sendiri. Diterima dan duplikat cukup lewat sendiri
    // supaya tangan operator tidak berhenti mengepak.
    // Ketiganya memakai kotak besar khusus scan (.cn-scan-toast di
    // globals.css): operator membacanya dari depan meja sambil memegang
    // scanner, bukan dari depan layar. Yang diterima sekaligus hijau tua
    // berhuruf putih supaya "lanjut" terbaca sekilas tanpa mengeja pesannya.
    if (scan.status === "error") {
      toast.error(scan.message, {
        className: "cn-scan-toast",
        closeButton: true,
        duration: Infinity,
      })
      return
    }

    if (scan.status === "duplicate") {
      toast.warning(scan.message, {
        className: "cn-scan-toast",
        closeButton: true,
        duration: 8_000,
      })
      return
    }

    toast.success(scan.message ?? "Scan diterima.", {
      className: "cn-scan-toast cn-scan-toast-accepted",
      duration: 3_000,
    })
  }, [muted, scanner.lastScan])

  // Perpindahan ke daftar label box dikerjakan closeLabelBoxBatchAction lewat
  // redirect() di server; lihat komentarnya di sana. Mengulanginya di sini
  // hanya akan berlomba dengan penyegaran route yang sudah tidak ada lagi.

  const allBoxes = batch.sets.flatMap((set) => set.boxes)
  const activeBox = allBoxes.find((labelBox) => !labelBox.verified)
  const scanState = resolveScanState({
    activeBoxNumber: activeBox?.boxNumber ?? null,
    lastScan: scanner.lastScan,
    pageFocused,
    pending: scanner.pending,
  })
  /**
   * Progress dihitung dari keping yang diminta seluruh label box, bukan dari
   * cakupan produk Master Item. Syarat menutup batch adalah setiap label box
   * penuh, jadi angka yang menghitung tiap produk sekali akan menjanjikan
   * pekerjaan setengah: qty delivery menggandakan box, dan penggandaan itu
   * membuat set kedua tidak pernah terhitung.
   */
  const expectedTotal = allBoxes.reduce(
    (total, labelBox) => total + labelBox.expectedQty,
    0,
  )
  const acceptedTotal = allBoxes.reduce(
    (total, labelBox) => total + labelBox.acceptedQty,
    0,
  )
  /**
   * Box yang layernya tidak meminta produk apa pun tidak pernah bisa penuh,
   * jadi ia tidak menahan penutupan batch — aturan yang sama dipakai penjaga
   * di close_label_box_batch.
   */
  const isPending = (labelBox: VerificationSetBox) =>
    !labelBox.verified && labelBox.expectedQty > 0
  const pendingBoxes = allBoxes.filter(isPending)
  const pendingSets = batch.sets.filter((set) => set.boxes.some(isPending))
  const allBoxesVerified = allBoxes.length > 0 && pendingBoxes.length === 0

  return (
    <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      {/* content-start: tanpa ini baris kolom kiri diregangkan mengikuti tinggi
          daftar produk di kanan, dan tiap kartu tumbuh jadi ruang kosong. */}
      <div className="grid content-start gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Button asChild className="mb-2 px-0" variant="link">
              <Link href="/scan">
                <ArrowLeftIcon data-icon="inline-start" />
                Daftar label box
              </Link>
            </Button>
            <h1 className="text-2xl font-semibold">{batch.deliveryNumber}</h1>
            <p className="text-muted-foreground text-sm">
              {batch.supplierCode} · {batch.partNo} · Lot {batch.lotNo} · Qty{" "}
              {batch.qtyDelivery}
            </p>
          </div>
          <Button
            aria-label={muted ? "Nyalakan bunyi scan" : "Matikan bunyi scan"}
            onClick={() => setMuted(!muted)}
            size="icon"
            type="button"
            variant="outline"
          >
            {muted ? <VolumeOffIcon /> : <Volume2Icon />}
          </Button>
        </div>

        {/* Progress dan keadaan scanner dibaca bersamaan sebelum tembakan
            berikutnya, jadi keduanya berdiri sebaris. Progress cukup selebar
            isinya; sisa baris jadi milik banner scan yang teksnya berubah-ubah. */}
        <div className="grid items-stretch gap-5 md:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)]">
          <div className="rounded-xl border p-5">
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <p className="text-muted-foreground text-sm">
                  Keping terscan · {batch.sets.length} set
                </p>
                <p className="text-3xl font-semibold tabular-nums">
                  {acceptedTotal} / {expectedTotal}
                </p>
              </div>
              <span className="text-muted-foreground text-sm">
                {percentage(acceptedTotal, expectedTotal)}%
              </span>
            </div>
            <Progress value={percentage(acceptedTotal, expectedTotal)} />
          </div>

          {/* Ikon di kanan: mata membaca judul lebih dulu, dan penanda
              keadaan berdiri di ujung baris sebagai lampu status. */}
          <Alert
            className="flex items-center justify-between gap-4 px-5 py-4"
            variant={scanState.tone === "danger" ? "destructive" : "default"}
          >
            <div className="grid gap-0.5">
              <AlertTitle className="text-lg leading-tight font-semibold tracking-tight">
                {scanState.title}
              </AlertTitle>
              <AlertDescription className="text-sm leading-snug">
                {scanState.description}
              </AlertDescription>
            </div>
            <scanState.Icon
              className={cn(
                "size-6 shrink-0",
                scanState.tone === "success" && "text-success",
                scanState.tone === "busy" && "animate-spin",
                scanState.tone === "idle" && "text-muted-foreground",
              )}
            />
          </Alert>
        </div>

        {/* Kotak scan menangkap ketikan scanner langsung, tanpa bergantung
            pada fokus yang kebetulan mendarat di badan halaman. Isinya terlihat
            sehingga operator tahu tombolnya sampai atau tidak. Listener global
            mengabaikan input, jadi satu scan tidak terkirim dua kali. */}
        <div className="rounded-xl border p-5">
          <label
            className="mb-2 block text-sm font-medium"
            htmlFor="scan-input"
          >
            Kotak scan
          </label>
          <div className="flex flex-wrap gap-2">
            <Input
              autoComplete="off"
              autoFocus
              className="min-w-64 flex-1 font-mono"
              id="scan-input"
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
            <Button
              disabled={!manualPayload.trim() || scanner.pending}
              onClick={() => void submitPayload(manualPayload)}
              type="button"
              variant="outline"
            >
              Kirim
            </Button>
          </div>
          {scanner.lastRawPayload ? (
            <p className="mt-3 text-sm">
              <span className="text-muted-foreground">Terakhir terbaca: </span>
              <span className="font-mono font-bold break-all">
                {scanner.lastRawPayload}
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground mt-2 text-sm">
              Kotak ini terfokus sendiri dan mengirim otomatis. Kalau ditembak
              dan tetap kosong, tombol scanner tidak sampai ke jendela ini.
            </p>
          )}
        </div>

        {/* Cetak dilakukan di halaman ini, sebelum batch ditutup: operator
            harus melihat labelnya benar-benar keluar sebelum menyimpan batch. */}
        {allBoxesVerified ? (
          <LabelBoxBatchPrintCard
            batchId={batch.id}
            onPrinted={() => setPrintedThisSession(true)}
          />
        ) : null}

        <form action={closeAction} className="rounded-xl border p-5" noValidate>
          <input name="batchId" type="hidden" value={batch.id} />
          <div className="mb-3 flex items-center gap-2">
            <PackageCheckIcon className="size-5" />
            <h2 className="font-semibold">Selesaikan verifikasi</h2>
          </div>
          <p className="text-muted-foreground mb-4 text-sm">
            Menyelesaikan verifikasi menyimpan batch dan menutupnya dari scan.
            Datanya tetap bisa dibuka lagi untuk cetak ulang bila label rusak,
            hilang, atau kertas habis.
          </p>
          {closeState.error ? (
            <Alert className="mb-4" variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{closeState.error}</AlertDescription>
            </Alert>
          ) : null}
          {pendingBoxes.length > 0 ? (
            <p className="text-muted-foreground mb-3 text-sm">
              Masih {pendingBoxes.length} box yang belum penuh, tersebar di{" "}
              {pendingSets.length} set.
            </p>
          ) : !printed ? (
            <p className="text-muted-foreground mb-3 text-sm">
              Cetak labelnya dulu, lalu simpan batch ini.
            </p>
          ) : null}
          <Button
            disabled={closePending || !allBoxesVerified || !printed}
            type="submit"
          >
            {closePending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <PackageCheckIcon data-icon="inline-start" />
            )}
            Selesaikan verifikasi
          </Button>
        </form>
      </div>

      {/* Satu section per set label, dan di dalamnya box lalu layer — bentuk
          yang sama dengan urutan pengepakan di meja. Set kedua berdiri
          sendiri: kepingnya lain, kuotanya lain, dan operator harus melihat
          bahwa pekerjaannya belum selesai setelah set pertama penuh. */}
      <aside className="rounded-xl border p-5 xl:sticky xl:top-6">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="font-semibold">Set, box &amp; layer</h2>
          <span className="text-muted-foreground text-sm tabular-nums">
            {allBoxes.length - pendingBoxes.length}/{allBoxes.length} box
          </span>
        </div>
        {/* Daftar panjang hanya digulung sendiri saat panel jadi kolom
            terpisah; di layar sempit ia ikut gulungan halaman. */}
        <div className="grid gap-5 xl:max-h-[calc(100vh-12rem)] xl:overflow-y-auto">
          {batch.sets.length > 0 ? (
            batch.sets.map((set) => (
              <div key={set.setNo}>
                <div className="bg-background sticky top-0 mb-2 flex items-baseline justify-between gap-2 border-b pb-1">
                  <p className="text-sm font-semibold">Set {set.setNo}</p>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {set.boxes.filter((labelBox) => labelBox.verified).length}/
                    {set.boxes.length} box penuh
                  </span>
                </div>

                <div className="grid gap-3">
                  {set.boxes.map((labelBox) => (
                    <div key={labelBox.id}>
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium">
                          <span className="font-mono">
                            {labelBox.boxNumber}
                          </span>{" "}
                          <span className="text-muted-foreground">
                            {labelBox.boxName}
                          </span>
                        </p>
                        {labelBox.id === activeBox?.id ? (
                          <Badge>Diisi</Badge>
                        ) : labelBox.verified ? (
                          <Badge variant="secondary">Penuh</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs tabular-nums">
                            {labelBox.acceptedQty}/{labelBox.expectedQty}
                          </span>
                        )}
                      </div>

                      {labelBox.layers.map((layer) => (
                        <div className="mt-2" key={layer.id}>
                          <p className="text-muted-foreground mb-1 text-xs">
                            Layer {layer.layerNo} ·{" "}
                            {shortenLayerName(layer.layerName)}
                          </p>
                          <div className="grid gap-1">
                            {layer.products.map((product) => {
                              const complete =
                                product.acceptedQty >= product.expectedQty
                              return (
                                <div
                                  className={cn(
                                    "flex items-center justify-between gap-2 rounded-md border px-2 py-1.5",
                                    complete
                                      ? "border-success/30 bg-success/10"
                                      : "bg-muted/50 border-transparent",
                                  )}
                                  key={product.id}
                                >
                                  <span className="text-xs">
                                    {formatProductPreview(
                                      product.partName,
                                      product.outerDiameter,
                                      product.innerDiameter,
                                      product.length,
                                    )}
                                  </span>
                                  <span className="flex shrink-0 items-center gap-1.5">
                                    <span className="text-muted-foreground text-xs tabular-nums">
                                      {Math.min(
                                        product.acceptedQty,
                                        product.expectedQty,
                                      )}
                                      /{product.expectedQty}
                                    </span>
                                    {complete ? (
                                      <CircleCheckIcon className="text-success size-4" />
                                    ) : (
                                      <XCircleIcon className="text-destructive size-4" />
                                    )}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground text-sm">
              Master Item ini belum punya box.
            </p>
          )}
        </div>
      </aside>
    </section>
  )
}
