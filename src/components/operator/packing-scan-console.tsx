"use client"

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  PackageCheckIcon,
  PlusIcon,
  ScanLineIcon,
  Volume2Icon,
  VolumeOffIcon,
} from "lucide-react"

import { finalizePackingSessionAction } from "@/features/finalize/actions"
import { initialFinalizePackingSessionActionState } from "@/features/finalize/form-state"
import {
  acceptPackingScanAction,
  startPackingSessionAction,
} from "@/features/scan/actions"
import { initialPackingSessionActionState } from "@/features/scan/form-state"
import { PrintJobCard } from "@/features/print/components/print-job-card"
import { useScannerListener } from "@/features/scan/use-scanner-listener"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { formatLabelFields } from "@/lib/label/formatter"

export type ScanMasterItemOption = {
  defaultLabelQty: number
  id: string
  itemCode: string
  partName: string
  partNo: string
  supplierId: string | null
}

export type ScanSupplierOption = {
  id: string
  supplierCode: string
  supplierName: string
}

export type ScanBoxOption = {
  boxCode: string
  boxName: string
  id: string
  masterItemId: string
}

export type ScanLayerProgress = {
  acceptedQty: number
  expectedQty: number
  id: string
  layerName: string | null
  layerNo: number
}

export type RecentScan = {
  errorCode: string | null
  id: string
  result: "accepted" | "duplicate" | "invalid" | "over_qty"
  scannedAt: string
}

export type ActivePackingSessionView = {
  acceptedQty: number
  boxCode: string
  boxName: string
  id: string
  layers: ScanLayerProgress[]
  masterItemName: string
  masterItemPartNo: string
  recentScans: RecentScan[]
  status: string
  totalExpectedQty: number
}

function percentage(acceptedQty: number, expectedQty: number): number {
  if (expectedQty <= 0) return 0
  return Math.min(100, Math.round((acceptedQty / expectedQty) * 100))
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

function formatScanTime(value: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value))
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
    // Some browsers restrict audio before a user gesture. The visual state remains.
  }
}

function StartSessionForm({
  allowedBoxes,
  filteredMasterItems,
  onCancel,
  selectedBoxId,
  selectedMasterItem,
  selectedMasterItemId,
  selectedSupplierId,
  setSelectedBoxId,
  setSelectedMasterItemId,
  setSelectedSupplierId,
  startAction,
  startPending,
  startState,
  suppliers,
}: {
  allowedBoxes: ScanBoxOption[]
  filteredMasterItems: ScanMasterItemOption[]
  onCancel: (() => void) | null
  selectedBoxId: string
  selectedMasterItem: ScanMasterItemOption | null
  selectedMasterItemId: string
  selectedSupplierId: string
  setSelectedBoxId: (value: string) => void
  setSelectedMasterItemId: (value: string) => void
  setSelectedSupplierId: (value: string) => void
  startAction: (formData: FormData) => void
  startPending: boolean
  startState: { error?: string }
  suppliers: ScanSupplierOption[]
}) {
  return (
    <section className="grid w-full gap-6">
      <div className="space-y-2">
        {onCancel ? (
          <Button
            className="px-0"
            onClick={onCancel}
            type="button"
            variant="link"
          >
            <ArrowLeftIcon data-icon="inline-start" />
            Kembali ke daftar session
          </Button>
        ) : null}
        <h1 className="text-2xl font-semibold">Mulai packing session</h1>
        <p className="text-muted-foreground text-sm">
          Isi data delivery dan pilih Box. Scanner hanya aktif setelah session
          dibuat.
        </p>
      </div>
      {suppliers.length === 0 ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Supplier tidak tersedia</AlertTitle>
          <AlertDescription>Tidak ada supplier aktif.</AlertDescription>
        </Alert>
      ) : (
        <form action={startAction} className="rounded-xl border p-5" noValidate>
          {startState.error ? (
            <Alert className="mb-5" variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{startState.error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            <input name="supplierId" type="hidden" value={selectedSupplierId} />
            <input
              name="masterItemId"
              type="hidden"
              value={selectedMasterItemId}
            />
            <input name="boxId" type="hidden" value={selectedBoxId} />

            <Field>
              <FieldLabel htmlFor="scan-supplier">Kode supplier</FieldLabel>
              <Select
                onValueChange={(value) => {
                  setSelectedSupplierId(value)
                  setSelectedMasterItemId("")
                  setSelectedBoxId("")
                }}
                value={selectedSupplierId}
              >
                <SelectTrigger id="scan-supplier" className="w-full">
                  <SelectValue placeholder="Pilih supplier aktif" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.supplierCode} · {supplier.supplierName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="scan-master-item">
                Master Item / Part No
              </FieldLabel>
              <Select
                key={selectedSupplierId}
                onValueChange={(value) => {
                  setSelectedMasterItemId(value)
                  setSelectedBoxId("")
                }}
                value={selectedMasterItemId}
              >
                <SelectTrigger id="scan-master-item" className="w-full">
                  <SelectValue placeholder="Pilih Part No" />
                </SelectTrigger>
                <SelectContent>
                  {filteredMasterItems.length === 0 ? (
                    <div className="text-muted-foreground px-2 py-1.5 text-sm">
                      Tidak ada Master Item aktif untuk supplier ini.
                    </div>
                  ) : (
                    filteredMasterItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.partNo} · {item.partName}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <FieldDescription>
                Hanya Master Item milik supplier terpilih yang memiliki Box.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="scan-packing-qty">
                Packing Qty (Master Item)
              </FieldLabel>
              <Input
                disabled
                id="scan-packing-qty"
                value={
                  selectedMasterItem
                    ? String(selectedMasterItem.defaultLabelQty)
                    : "Pilih Master Item terlebih dahulu"
                }
              />
              <FieldDescription>
                Nilai ini berasal dari master data dan tercetak di label.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="scan-box">Box</FieldLabel>
              <Select
                key={selectedMasterItemId}
                onValueChange={setSelectedBoxId}
                value={selectedBoxId}
              >
                <SelectTrigger id="scan-box" className="w-full">
                  <SelectValue placeholder="Pilih Box" />
                </SelectTrigger>
                <SelectContent>
                  {allowedBoxes.map((box) => (
                    <SelectItem key={box.id} value={box.id}>
                      {box.boxCode} · {box.boxName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="scan-qty-delivery">Qty Delivery</FieldLabel>
                <Input
                  id="scan-qty-delivery"
                  inputMode="numeric"
                  name="qtyDelivery"
                  placeholder="100"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="scan-lot-no">Lot No</FieldLabel>
                <Input
                  id="scan-lot-no"
                  maxLength={100}
                  name="lotNo"
                  placeholder="LOT-2026-07-001"
                  required
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="scan-delivery-date">
                Tanggal Delivery
              </FieldLabel>
              <Input
                id="scan-delivery-date"
                name="deliveryDate"
                required
                type="date"
              />
              <FieldDescription>
                Delivery Number dibuat otomatis dari supplier dan tanggal ini.
              </FieldDescription>
            </Field>

            <Button
              disabled={
                startPending ||
                !selectedSupplierId ||
                !selectedMasterItemId ||
                !selectedBoxId
              }
              type="submit"
            >
              {startPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <ScanLineIcon data-icon="inline-start" />
              )}
              Mulai scan
            </Button>
          </FieldGroup>
        </form>
      )}
    </section>
  )
}

function SessionListView({
  onSelect,
  onStartNew,
  sessions,
}: {
  onSelect: (sessionId: string) => void
  onStartNew: () => void
  sessions: ActivePackingSessionView[]
}) {
  return (
    <section className="mx-auto grid max-w-3xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Session packing aktif</h1>
          <p className="text-muted-foreground text-sm">
            Pilih session untuk melanjutkan scan, atau mulai session baru.
          </p>
        </div>
        <Button onClick={onStartNew} type="button">
          <PlusIcon data-icon="inline-start" />
          Mulai session baru
        </Button>
      </div>
      <div className="grid gap-3">
        {sessions.map((session) => {
          const sessionProgress = percentage(
            session.acceptedQty,
            session.totalExpectedQty,
          )
          return (
            <button
              className="hover:bg-muted/50 rounded-xl border p-5 text-left transition-colors"
              key={session.id}
              onClick={() => onSelect(session.id)}
              type="button"
            >
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{session.masterItemPartNo}</p>
                  <p className="text-muted-foreground text-sm">
                    {session.masterItemName} · {session.boxCode} · {session.boxName}
                  </p>
                </div>
                <Badge
                  variant={
                    session.status === "ready_to_finalize"
                      ? "default"
                      : "secondary"
                  }
                >
                  {session.status === "ready_to_finalize"
                    ? "Siap finalisasi"
                    : "Scanning"}
                </Badge>
              </div>
              <div className="mb-2 flex items-center justify-between gap-4">
                <span className="text-muted-foreground text-sm tabular-nums">
                  {session.acceptedQty} / {session.totalExpectedQty}
                </span>
                <span className="text-muted-foreground text-sm">
                  {sessionProgress}%
                </span>
              </div>
              <Progress value={sessionProgress} />
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function PackingScanConsole({
  activeSessions,
  boxes,
  masterItems,
  suppliers,
}: {
  activeSessions: ActivePackingSessionView[]
  boxes: ScanBoxOption[]
  masterItems: ScanMasterItemOption[]
  suppliers: ScanSupplierOption[]
}) {
  const router = useRouter()
  const [startState, startAction, startPending] = useActionState(
    startPackingSessionAction,
    initialPackingSessionActionState,
  )
  const [selectedSupplierId, setSelectedSupplierId] = useState("")
  const [selectedMasterItemId, setSelectedMasterItemId] = useState("")
  const [selectedBoxId, setSelectedBoxId] = useState("")
  const startSucceeded = useRef(false)
  useActionStateToast(startState)

  const [view, setView] = useState<
    { type: "list" } | { type: "start" } | { type: "detail"; sessionId: string }
  >(activeSessions.length === 0 ? { type: "start" } : { type: "list" })

  useEffect(() => {
    if (!startState.success || startSucceeded.current) return
    startSucceeded.current = true
    setView({ type: "list" })
    router.refresh()
  }, [router, startState.success])

  const [finalizeState, finalizeFormAction, finalizePending] = useActionState(
    finalizePackingSessionAction,
    initialFinalizePackingSessionActionState,
  )
  const [completedSnapshot, setCompletedSnapshot] = useState<
    typeof finalizeState.snapshot
  >(undefined)
  const finalizeRefreshedSnapshot = useRef<typeof finalizeState.snapshot>(
    undefined,
  )
  useActionStateToast(finalizeState)

  useEffect(() => {
    if (
      !finalizeState.snapshot ||
      finalizeRefreshedSnapshot.current === finalizeState.snapshot
    ) {
      return
    }
    finalizeRefreshedSnapshot.current = finalizeState.snapshot
    setCompletedSnapshot(finalizeState.snapshot)
    router.refresh()
  }, [finalizeState.snapshot, router])

  const activeSession = useMemo(
    () =>
      view.type === "detail"
        ? (activeSessions.find((session) => session.id === view.sessionId) ??
          null)
        : null,
    [activeSessions, view],
  )

  const onScan = useCallback(
    async (rawPayload: string) => {
      if (!activeSession) {
        return {
          message: "Mulai packing session terlebih dahulu.",
          status: "error" as const,
        }
      }

      const result = await acceptPackingScanAction({
        packingSessionId: activeSession.id,
        rawPayload,
      })
      if (result.status === "success") router.refresh()
      return result
    },
    [activeSession, router],
  )

  const scanner = useScannerListener({
    enabled: Boolean(activeSession),
    onScan,
  })
  const playedScanAt = useRef<number | null>(null)

  useEffect(() => {
    const scan = scanner.lastScan
    if (!scan || playedScanAt.current === scan.scannedAt.getTime()) return

    playedScanAt.current = scan.scannedAt.getTime()
    playScanTone(scan.status, scanner.muted)

    // A rejected scan must not scroll away behind the next one: hold the
    // toast until the operator dismisses it.
    if (scan.status === "error") {
      toast.error(scan.message, { closeButton: true, duration: Infinity })
    }
  }, [scanner.lastScan, scanner.muted])

  const filteredMasterItems = useMemo(
    () =>
      masterItems.filter(
        (item) =>
          item.supplierId === null || item.supplierId === selectedSupplierId,
      ),
    [masterItems, selectedSupplierId],
  )

  const selectedMasterItem = useMemo(
    () => masterItems.find((item) => item.id === selectedMasterItemId) ?? null,
    [masterItems, selectedMasterItemId],
  )

  const allowedBoxes = useMemo(
    () => boxes.filter((box) => box.masterItemId === selectedMasterItemId),
    [boxes, selectedMasterItemId],
  )

  const autoFinalizedSessionId = useRef<string | null>(null)

  // Every layer is full, so finalize without asking. The Delivery Number was
  // already resolved when the session started; PrintJobCard then auto-prints
  // once QZ and a printer are ready.
  useEffect(() => {
    if (
      !activeSession ||
      activeSession.status !== "ready_to_finalize" ||
      autoFinalizedSessionId.current === activeSession.id ||
      finalizePending
    ) {
      return
    }

    autoFinalizedSessionId.current = activeSession.id
    const payload = new FormData()
    payload.set("packingSessionId", activeSession.id)
    finalizeFormAction(payload)
  }, [activeSession, finalizeFormAction, finalizePending])

  if (completedSnapshot) {
    const labelFields = formatLabelFields(completedSnapshot)
    return (
      <section className="mx-auto grid max-w-2xl gap-6">
        <Alert>
          <PackageCheckIcon className="size-7" />
          <AlertTitle className="text-xl font-semibold">
            {completedSnapshot.alreadyFinalized
              ? "Session ini sudah difinalisasi sebelumnya"
              : "Finalisasi berhasil"}
          </AlertTitle>
          <AlertDescription className="text-sm">
            Label Reference:{" "}
            <span className="text-foreground font-semibold">
              {labelFields.itemBoxReference}
            </span>
          </AlertDescription>
        </Alert>
        <div className="grid gap-2 rounded-xl border p-5 text-sm">
          <SummaryRow label="Supplier Code" value={labelFields.supplierCode} />
          <SummaryRow label="Part No" value={labelFields.partNo} />
          <SummaryRow label="Qty" value={labelFields.qty} />
          <SummaryRow
            label="No Urut Item"
            value={labelFields.itemBoxReference}
          />
          <SummaryRow
            label="Delivery Number"
            value={labelFields.deliveryNumber}
          />
          <SummaryRow label="Nama Box" value={labelFields.boxName} />
          <SummaryRow
            label="Tanggal Delivery"
            value={labelFields.deliveryDate}
          />
          <SummaryRow
            label="Qty Delivery"
            value={String(completedSnapshot.qtyDelivery)}
          />
          <SummaryRow label="Lot No" value={completedSnapshot.lotNo} />
        </div>
        <PrintJobCard snapshot={completedSnapshot} />
        <Button
          onClick={() => {
            setCompletedSnapshot(undefined)
            setSelectedSupplierId("")
            setSelectedMasterItemId("")
            setSelectedBoxId("")
            setView(activeSessions.length > 1 ? { type: "list" } : { type: "start" })
          }}
          type="button"
          variant="outline"
        >
          Mulai session baru
        </Button>
      </section>
    )
  }

  if (view.type === "start") {
    return (
      <StartSessionForm
        allowedBoxes={allowedBoxes}
        filteredMasterItems={filteredMasterItems}
        onCancel={
          activeSessions.length > 0 ? () => setView({ type: "list" }) : null
        }
        selectedBoxId={selectedBoxId}
        selectedMasterItem={selectedMasterItem}
        selectedMasterItemId={selectedMasterItemId}
        selectedSupplierId={selectedSupplierId}
        setSelectedBoxId={setSelectedBoxId}
        setSelectedMasterItemId={setSelectedMasterItemId}
        setSelectedSupplierId={setSelectedSupplierId}
        startAction={startAction}
        startPending={startPending}
        startState={startState}
        suppliers={suppliers}
      />
    )
  }

  if (view.type === "list" || !activeSession) {
    return (
      <SessionListView
        onSelect={(sessionId) => setView({ type: "detail", sessionId })}
        onStartNew={() => setView({ type: "start" })}
        sessions={activeSessions}
      />
    )
  }

  const sessionProgress = percentage(
    activeSession.acceptedQty,
    activeSession.totalExpectedQty,
  )

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="grid gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Button
              className="mb-2 px-0"
              onClick={() => setView({ type: "list" })}
              type="button"
              variant="link"
            >
              <ArrowLeftIcon data-icon="inline-start" />
              Daftar session
            </Button>
            <p className="text-muted-foreground text-sm font-medium">
              Scan aktif
            </p>
            <h1 className="text-2xl font-semibold">
              {activeSession.masterItemPartNo}
            </h1>
            <p className="text-muted-foreground text-sm">
              {activeSession.masterItemName} · {activeSession.boxCode} · {activeSession.boxName}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={
                activeSession.status === "ready_to_finalize"
                  ? "default"
                  : "secondary"
              }
            >
              {activeSession.status === "ready_to_finalize"
                ? "Siap finalisasi"
                : "Scanning"}
            </Badge>
            <Button
              aria-label={
                scanner.muted ? "Nyalakan bunyi scan" : "Matikan bunyi scan"
              }
              onClick={() => scanner.setMuted(!scanner.muted)}
              size="icon"
              type="button"
              variant="outline"
            >
              {scanner.muted ? <VolumeOffIcon /> : <Volume2Icon />}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border p-5">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p className="text-muted-foreground text-sm">Total progress</p>
              <p className="text-3xl font-semibold tabular-nums">
                {activeSession.acceptedQty} / {activeSession.totalExpectedQty}
              </p>
            </div>
            <span className="text-muted-foreground text-sm">
              {sessionProgress}%
            </span>
          </div>
          <Progress value={sessionProgress} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {activeSession.layers.map((layer) => {
            const layerProgress = percentage(
              layer.acceptedQty,
              layer.expectedQty,
            )
            return (
              <div className="rounded-xl border p-4" key={layer.id}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="font-medium">
                    Layer {layer.layerNo}
                    {layer.layerName ? ` · ${layer.layerName}` : ""}
                  </p>
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {layer.acceptedQty} / {layer.expectedQty}
                  </span>
                </div>
                <Progress value={layerProgress} />
              </div>
            )
          })}
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
              "Arahkan fokus ke halaman ini lalu scan QR. Input dan dialog tidak akan ditangkap."}
          </AlertDescription>
        </Alert>

        {activeSession.status === "ready_to_finalize" ? (
          <div className="rounded-xl border p-5">
            <div className="mb-3 flex items-center gap-2">
              {finalizePending ? (
                <Spinner className="size-5" />
              ) : (
                <PackageCheckIcon className="size-5" />
              )}
              <h2 className="font-semibold">
                {finalizePending
                  ? "Memfinalisasi box…"
                  : "Box lengkap, menunggu finalisasi"}
              </h2>
            </div>
            <p className="text-muted-foreground text-sm">
              Semua layer terpenuhi. Label dibuat dan dikirim ke printer secara
              otomatis.
            </p>
            {finalizeState.error ? (
              <Alert className="mt-4" variant="destructive">
                <CircleAlertIcon />
                <AlertDescription>{finalizeState.error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}
      </div>

      <aside className="rounded-xl border p-5">
        <h2 className="mb-3 font-semibold">Scan terakhir</h2>
        <div className="grid gap-2">
          {scanner.recentScans.length > 0
            ? scanner.recentScans.map((scan) => (
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
                    <p className="text-muted-foreground text-xs">
                      {scan.message}
                    </p>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {formatScanTime(scan.scannedAt.toISOString())}
                  </span>
                </div>
              ))
            : activeSession.recentScans.map((scan) => (
                <div
                  className="bg-muted/50 flex items-start justify-between gap-3 rounded-lg p-3"
                  key={scan.id}
                >
                  <div>
                    <p className="text-sm font-medium">
                      {scan.result === "accepted"
                        ? "Diterima"
                        : scan.result === "duplicate"
                          ? "Duplikat"
                          : "Ditolak"}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {scan.errorCode ?? "Tersimpan dari session sebelumnya"}
                    </p>
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {formatScanTime(scan.scannedAt)}
                  </span>
                </div>
              ))}
          {scanner.recentScans.length === 0 &&
          activeSession.recentScans.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Belum ada scan pada session ini.
            </p>
          ) : null}
        </div>
      </aside>
    </section>
  )
}
