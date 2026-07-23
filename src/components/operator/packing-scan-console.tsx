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
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  PackageCheckIcon,
  PlusIcon,
  ScanLineIcon,
  SearchIcon,
  Volume2Icon,
  VolumeOffIcon,
} from "lucide-react"

import {
  CreateDeliveryNumberDialog,
  type CreateDeliveryNumberSupplier,
} from "@/features/delivery-numbers/components/create-delivery-number-dialog"
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
  id: string
  itemCode: string
  partName: string
  partNo: string
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

export type DeliveryNumberOption = {
  deliveryDate: string
  deliveryNumber: string
  id: string
  supplierCode: string
  supplierId: string
  supplierName: string
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
  masterItems,
  onCancel,
  selectedBoxDefinitionId,
  selectedMasterItemId,
  setSelectedBoxDefinitionId,
  setSelectedMasterItemId,
  startAction,
  startPending,
  startState,
}: {
  allowedBoxes: ScanBoxOption[]
  masterItems: ScanMasterItemOption[]
  onCancel: (() => void) | null
  selectedBoxDefinitionId: string
  selectedMasterItemId: string
  setSelectedBoxDefinitionId: (value: string) => void
  setSelectedMasterItemId: (value: string) => void
  startAction: (formData: FormData) => void
  startPending: boolean
  startState: { error?: string }
}) {
  return (
    <section className="mx-auto grid max-w-2xl gap-6">
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
        <p className="text-muted-foreground text-sm font-medium">Phase 5</p>
        <h1 className="text-2xl font-semibold">Mulai packing session</h1>
        <p className="text-muted-foreground text-sm">
          Pilih Part No dan Box aktif. Scanner hanya aktif setelah session
          dibuat.
        </p>
      </div>
      {masterItems.length === 0 ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Master Item tidak tersedia</AlertTitle>
          <AlertDescription>
            Tidak ada Master Item aktif yang memiliki Box aktif.
          </AlertDescription>
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
            <input
              name="masterItemId"
              type="hidden"
              value={selectedMasterItemId}
            />
            <input
              name="boxId"
              type="hidden"
              value={selectedBoxDefinitionId}
            />
            <Field>
              <FieldLabel htmlFor="scan-master-item">
                Master Item / Part No
              </FieldLabel>
              <Select
                onValueChange={(value) => {
                  setSelectedMasterItemId(value)
                  setSelectedBoxDefinitionId("")
                }}
                value={selectedMasterItemId}
              >
                <SelectTrigger id="scan-master-item" className="w-full">
                  <SelectValue placeholder="Pilih Part No" />
                </SelectTrigger>
                <SelectContent>
                  {masterItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.partNo} · {item.partName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="scan-box-definition">
                Box Definition
              </FieldLabel>
              <Select
                key={selectedMasterItemId}
                onValueChange={(value) => {
                  setSelectedBoxDefinitionId(value)
                }}
                value={selectedBoxDefinitionId}
              >
                <SelectTrigger id="scan-box-definition" className="w-full">
                  <SelectValue placeholder="Pilih Box aktif" />
                </SelectTrigger>
                <SelectContent>
                  {allowedBoxes.map((boxDefinition) => (
                    <SelectItem key={boxDefinition.id} value={boxDefinition.id}>
                      {boxDefinition.boxCode} · {boxDefinition.boxName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Hanya Box aktif yang sesuai Master Item dapat dipilih.
              </FieldDescription>
            </Field>
            <Button disabled={startPending} type="submit">
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
          <p className="text-muted-foreground text-sm font-medium">Phase 5</p>
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
  deliveryNumbers,
  masterItems,
  suppliers,
}: {
  activeSessions: ActivePackingSessionView[]
  boxes: ScanBoxOption[]
  deliveryNumbers: DeliveryNumberOption[]
  masterItems: ScanMasterItemOption[]
  suppliers: CreateDeliveryNumberSupplier[]
}) {
  const router = useRouter()
  const [startState, startAction, startPending] = useActionState(
    startPackingSessionAction,
    initialPackingSessionActionState,
  )
  const [selectedMasterItemId, setSelectedMasterItemId] = useState("")
  const [selectedBoxDefinitionId, setSelectedBoxDefinitionId] = useState("")
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
  const [selectedDeliveryNumberId, setSelectedDeliveryNumberId] = useState("")
  const [deliveryNumberQuery, setDeliveryNumberQuery] = useState("")
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

  const filteredDeliveryNumbers = useMemo(() => {
    const query = deliveryNumberQuery.trim().toLowerCase()
    if (!query) return deliveryNumbers
    return deliveryNumbers.filter(
      (deliveryNumber) =>
        deliveryNumber.supplierCode.toLowerCase().includes(query) ||
        deliveryNumber.deliveryNumber.toLowerCase().includes(query),
    )
  }, [deliveryNumbers, deliveryNumberQuery])

  const selectedDeliveryNumber = useMemo(
    () =>
      deliveryNumbers.find(
        (deliveryNumber) => deliveryNumber.id === selectedDeliveryNumberId,
      ) ?? null,
    [deliveryNumbers, selectedDeliveryNumberId],
  )

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
  }, [scanner.lastScan, scanner.muted])
  const allowedBoxes = useMemo(
    () =>
      boxes.filter(
        (boxDefinition) => boxDefinition.masterItemId === selectedMasterItemId,
      ),
    [boxes, selectedMasterItemId],
  )

  const previewLabelFields = useMemo(() => {
    if (!activeSession || !selectedDeliveryNumber) return null
    return formatLabelFields({
      boxCode: activeSession.boxCode,
      boxName: activeSession.boxName,
      deliveryDate: selectedDeliveryNumber.deliveryDate,
      deliveryNumber: selectedDeliveryNumber.deliveryNumber,
      labelReference: "—",
      partName: activeSession.masterItemName,
      partNo: activeSession.masterItemPartNo,
      qty: activeSession.totalExpectedQty,
      sequenceNo: 0,
      supplierCode: selectedDeliveryNumber.supplierCode,
    })
  }, [activeSession, selectedDeliveryNumber])

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
        </div>
        <PrintJobCard snapshot={completedSnapshot} />
        <Button
          onClick={() => {
            setCompletedSnapshot(undefined)
            setSelectedDeliveryNumberId("")
            setDeliveryNumberQuery("")
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
        masterItems={masterItems}
        onCancel={
          activeSessions.length > 0 ? () => setView({ type: "list" }) : null
        }
        selectedBoxDefinitionId={selectedBoxDefinitionId}
        selectedMasterItemId={selectedMasterItemId}
        setSelectedBoxDefinitionId={setSelectedBoxDefinitionId}
        setSelectedMasterItemId={setSelectedMasterItemId}
        startAction={startAction}
        startPending={startPending}
        startState={startState}
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
            <div className="mb-4">
              <h2 className="font-semibold">Finalisasi box</h2>
              <p className="text-muted-foreground text-sm">
                Pilih Delivery Number aktif untuk membuat print job. Box tidak
                dapat diubah lagi setelah difinalisasi.
              </p>
            </div>
            {finalizeState.error ? (
              <Alert className="mb-4" variant="destructive">
                <CircleAlertIcon />
                <AlertDescription>{finalizeState.error}</AlertDescription>
              </Alert>
            ) : null}
            <form action={finalizeFormAction} noValidate>
              <input
                name="packingSessionId"
                type="hidden"
                value={activeSession.id}
              />
              <input
                name="deliveryNumberId"
                type="hidden"
                value={selectedDeliveryNumberId}
              />
              <FieldGroup>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-muted-foreground text-sm">
                    Pilih Delivery Number aktif, atau buat baru.
                  </p>
                  <CreateDeliveryNumberDialog suppliers={suppliers} />
                </div>
                <Field>
                  <FieldLabel htmlFor="finalize-dn-search">
                    Cari Delivery Number
                  </FieldLabel>
                  <div className="relative">
                    <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                    <Input
                      className="pl-9"
                      id="finalize-dn-search"
                      onChange={(event) =>
                        setDeliveryNumberQuery(event.target.value)
                      }
                      placeholder="Cari supplier code atau nomor DN"
                      value={deliveryNumberQuery}
                    />
                  </div>
                </Field>
                <Field>
                  <FieldLabel htmlFor="finalize-dn">
                    Delivery Number aktif
                  </FieldLabel>
                  <Select
                    onValueChange={setSelectedDeliveryNumberId}
                    value={selectedDeliveryNumberId}
                  >
                    <SelectTrigger id="finalize-dn" className="w-full">
                      <SelectValue placeholder="Pilih Delivery Number" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredDeliveryNumbers.length === 0 ? (
                        <div className="text-muted-foreground px-2 py-1.5 text-sm">
                          Tidak ada Delivery Number yang cocok.
                        </div>
                      ) : (
                        filteredDeliveryNumbers.map((deliveryNumber) => (
                          <SelectItem
                            key={deliveryNumber.id}
                            value={deliveryNumber.id}
                          >
                            {deliveryNumber.supplierCode} ·{" "}
                            {deliveryNumber.deliveryNumber}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    Hanya Delivery Number berstatus aktif yang ditampilkan
                    (BR-09).
                  </FieldDescription>
                </Field>

                {selectedDeliveryNumber && previewLabelFields ? (
                  <div className="bg-muted/50 grid gap-2 rounded-lg p-4 text-sm">
                    <p className="font-medium">
                      Ringkasan sebelum finalisasi
                    </p>
                    <SummaryRow
                      label="Part No"
                      value={`${previewLabelFields.partNo} · ${activeSession.masterItemName}`}
                    />
                    <SummaryRow
                      label="Box"
                      value={`${activeSession.boxCode} · ${previewLabelFields.boxName}`}
                    />
                    {activeSession.layers.map((layer) => (
                      <SummaryRow
                        key={layer.id}
                        label={`Layer ${layer.layerNo}${layer.layerName ? ` · ${layer.layerName}` : ""}`}
                        value={`${layer.acceptedQty} / ${layer.expectedQty}`}
                      />
                    ))}
                    <SummaryRow
                      label="Total diterima"
                      value={`${activeSession.acceptedQty} / ${activeSession.totalExpectedQty}`}
                    />
                    <SummaryRow
                      label="Supplier"
                      value={`${selectedDeliveryNumber.supplierCode} · ${selectedDeliveryNumber.supplierName}`}
                    />
                    <SummaryRow
                      label="Delivery Number"
                      value={previewLabelFields.deliveryNumber}
                    />
                    <SummaryRow
                      label="Tanggal Delivery"
                      value={previewLabelFields.deliveryDate}
                    />
                  </div>
                ) : null}

                <Button
                  disabled={finalizePending || !selectedDeliveryNumberId}
                  type="submit"
                >
                  {finalizePending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <PackageCheckIcon data-icon="inline-start" />
                  )}
                  Finalisasi box
                </Button>
              </FieldGroup>
            </form>
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
