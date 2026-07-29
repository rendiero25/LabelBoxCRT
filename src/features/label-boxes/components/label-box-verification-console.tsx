"use client"

import { useActionState, useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  PackageCheckIcon,
  ScanLineIcon,
  Volume2Icon,
  VolumeOffIcon,
} from "lucide-react"
import Link from "next/link"

import { acceptLabelBoxScanAction, closeLabelBoxBatchAction } from "@/features/label-boxes/verification-actions"
import { initialCloseLabelBoxBatchActionState } from "@/features/label-boxes/verification-form-state"
import { useScannerListener } from "@/features/scan/use-scanner-listener"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Spinner } from "@/components/ui/spinner"

export type VerificationLabelBox = {
  acceptedQty: number
  boxNumber: string
  expectedQty: number
  id: string
  verified: boolean
}

export type VerificationBatchView = {
  deliveryDate: string
  deliveryNumber: string
  id: string
  itemCode: string
  labelBoxes: VerificationLabelBox[]
  lotNo: string
  qtyDelivery: number
  supplierCode: string
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
  const playedScanAt = useRef<number | null>(null)
  const closed = useRef(false)

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

  useEffect(() => {
    const scan = scanner.lastScan
    if (!scan || playedScanAt.current === scan.scannedAt.getTime()) return

    playedScanAt.current = scan.scannedAt.getTime()
    playScanTone(scan.status, muted)

    // Scan ditolak tidak boleh tergeser scan berikutnya: tahan sampai
    // operator menutupnya sendiri.
    if (scan.status === "error") {
      toast.error(scan.message, { closeButton: true, duration: Infinity })
    }
  }, [muted, scanner.lastScan])

  useEffect(() => {
    if (!closeState.success || closed.current) return
    closed.current = true
    router.push("/scan")
  }, [closeState.success, router])

  const acceptedTotal = batch.labelBoxes.reduce(
    (total, labelBox) => total + labelBox.acceptedQty,
    0,
  )
  const expectedTotal = batch.labelBoxes.reduce(
    (total, labelBox) => total + labelBox.expectedQty,
    0,
  )
  const activeBox = batch.labelBoxes.find((labelBox) => !labelBox.verified)

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid gap-5">
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
              {batch.supplierCode} · {batch.itemCode} · Lot {batch.lotNo} · Qty{" "}
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

        <div className="rounded-xl border p-5">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p className="text-muted-foreground text-sm">Total progress</p>
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

        <Alert
          className="items-center gap-x-4 px-5 py-4"
          variant={
            scanner.lastScan?.status === "error" ||
            scanner.lastScan?.status === "duplicate"
              ? "destructive"
              : "default"
          }
        >
          {scanner.lastScan?.status === "success" ? (
            <CircleCheckIcon className="size-7" />
          ) : (
            <ScanLineIcon className="size-7" />
          )}
          <AlertTitle className="text-xl font-semibold sm:text-2xl">
            {scanner.pending
              ? "Memproses scan…"
              : scanner.lastScan?.status === "success"
                ? "Scan diterima"
                : scanner.lastScan?.status === "duplicate"
                  ? "Label duplikat"
                  : scanner.lastScan?.status === "error"
                    ? "Scan ditolak"
                    : "Scanner siap"}
          </AlertTitle>
          <AlertDescription className="text-sm sm:text-base">
            {scanner.lastScan?.message ??
              (activeBox
                ? `Box aktif ${activeBox.boxNumber}. Arahkan fokus ke halaman ini lalu scan produk.`
                : "Semua box sudah penuh. Tutup verifikasi untuk lanjut mencetak.")}
          </AlertDescription>
        </Alert>

        <div className="grid gap-3 sm:grid-cols-2">
          {batch.labelBoxes.map((labelBox) => (
            <div className="rounded-xl border p-4" key={labelBox.id}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="font-mono font-medium">{labelBox.boxNumber}</p>
                {labelBox.verified ? (
                  <Badge variant="secondary">
                    <CircleCheckIcon data-icon="inline-start" />
                    Penuh
                  </Badge>
                ) : labelBox.id === activeBox?.id ? (
                  <Badge>Aktif</Badge>
                ) : (
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {labelBox.acceptedQty} / {labelBox.expectedQty}
                  </span>
                )}
              </div>
              <Progress
                value={percentage(labelBox.acceptedQty, labelBox.expectedQty)}
              />
            </div>
          ))}
        </div>

        <form action={closeAction} className="rounded-xl border p-5" noValidate>
          <input name="batchId" type="hidden" value={batch.id} />
          <div className="mb-3 flex items-center gap-2">
            <PackageCheckIcon className="size-5" />
            <h2 className="font-semibold">Selesaikan verifikasi</h2>
          </div>
          <p className="text-muted-foreground mb-4 text-sm">
            Batch yang ditutup tidak menerima scan lagi. Seluruh label kemudian
            dapat dicetak, termasuk box yang belum penuh.
          </p>
          {closeState.error ? (
            <Alert className="mb-4" variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{closeState.error}</AlertDescription>
            </Alert>
          ) : null}
          <Button disabled={closePending} type="submit">
            {closePending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <PackageCheckIcon data-icon="inline-start" />
            )}
            Selesaikan verifikasi
          </Button>
        </form>
      </div>

      <aside className="rounded-xl border p-5">
        <h2 className="mb-3 font-semibold">Scan terakhir</h2>
        <div className="grid gap-2">
          {scanner.recentScans.length > 0 ? (
            scanner.recentScans.map((scan) => (
              <div
                className="bg-muted/50 flex items-start justify-between gap-3 rounded-lg p-3"
                key={`${scan.scannedAt.toISOString()}-${scan.rawPayload}`}
              >
                <div>
                  <p className="text-sm font-medium">
                    {scan.status === "success"
                      ? "Diterima"
                      : scan.status === "duplicate"
                        ? "Duplikat"
                        : "Ditolak"}
                  </p>
                  <p className="text-muted-foreground text-xs">{scan.message}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground text-sm">
              Belum ada scan pada batch ini.
            </p>
          )}
        </div>
      </aside>
    </section>
  )
}
