"use client"

import { useActionState, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { CircleAlertIcon, PackageCheckIcon, PlusIcon } from "lucide-react"
import QRCode from "qrcode"

import { createLabelBoxBatchAction } from "@/features/label-boxes/actions"
import {
  initialLabelBoxBatchActionState,
  type LabelBoxBatchActionState,
  type LabelBoxBatchResult,
} from "@/features/label-boxes/form-state"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"

/**
 * Tanggal hari ini menurut jam workstation. `toISOString()` memberi tanggal
 * UTC, dan di WIB (UTC+7) shift pagi berjalan saat UTC masih di hari
 * sebelumnya — fieldnya akan terisi tanggal kemarin.
 */
function todayIsoDate(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

export type LabelBoxSupplierOption = {
  id: string
  supplierCode: string
}

export type LabelBoxMasterItemOption = {
  id: string
  itemCode: string
  packingQty: number
  partNo: string
  supplierId: string | null
}

/**
 * Tracks whether the result step should be visible. `state` from
 * `useActionState` outlives dialog close/reopen (the owning component never
 * unmounts), so `state.result` alone can't drive which step renders: simply
 * checking it would jump straight back into the previous batch's result on
 * reopen. This adjusts state during render when a *new* state object shows
 * up (a fresh one is produced on every action submission) — React's
 * documented pattern for deriving state from a changed prop/value without an
 * effect — and reveals the result step only when that new state actually
 * carries a result. Callers reset it explicitly on close.
 */
function useResultRevealedOnNewState(state: LabelBoxBatchActionState) {
  const [showResult, setShowResult] = useState(false)
  const [previousState, setPreviousState] = useState(state)

  if (previousState !== state) {
    setPreviousState(state)
    if (state.result) setShowResult(true)
  }

  return [showResult, setShowResult] as const
}

export function LabelBoxBatchDialog({
  masterItems,
  prefillMasterItemId = null,
  suppliers,
}: {
  masterItems: LabelBoxMasterItemOption[]
  prefillMasterItemId?: string | null
  suppliers: LabelBoxSupplierOption[]
}) {
  const [state, formAction, isPending] = useActionState(
    createLabelBoxBatchAction,
    initialLabelBoxBatchActionState,
  )
  useActionStateToast(state)

  const router = useRouter()
  const pathname = usePathname()

  // "Gunakan untuk Label Box" di Master Item mendarat di sini dengan
  // ?masterItemId=..., jadi dialognya langsung terbuka dan terisi. Hanya nilai
  // awal: setelah itu operator bebas mengubah pilihannya.
  const prefillMasterItem =
    masterItems.find((item) => item.id === prefillMasterItemId) ?? null

  const [open, setOpen] = useState(prefillMasterItem !== null)
  const [supplierId, setSupplierId] = useState(
    prefillMasterItem?.supplierId ?? "",
  )
  const [masterItemId, setMasterItemId] = useState(prefillMasterItem?.id ?? "")
  const [showResult, setShowResult] = useResultRevealedOnNewState(state)

  const filteredMasterItems = useMemo(
    () =>
      masterItems.filter(
        (item) => item.supplierId === null || item.supplierId === supplierId,
      ),
    [masterItems, supplierId],
  )

  const selectedMasterItem = useMemo(
    () => masterItems.find((item) => item.id === masterItemId) ?? null,
    [masterItemId, masterItems],
  )

  function resetForm() {
    setSupplierId("")
    setMasterItemId("")
    setShowResult(false)
    // Buang ?masterItemId dari URL supaya refresh atau tombol back tidak
    // membuka ulang dialog yang baru saja ditutup operator.
    if (prefillMasterItemId) router.replace(pathname)
  }

  function closeDialog() {
    setOpen(false)
    resetForm()
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) resetForm()
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button>
          <PlusIcon data-icon="inline-start" />
          Tambah
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {showResult && state.result ? (
          <GeneratedStep onFinish={closeDialog} result={state.result} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Tambah label box</DialogTitle>
              <DialogDescription>
                Nomor box dan QR dibuat otomatis dari Qty Delivery dibagi
                Packing Qty Master Item.
              </DialogDescription>
            </DialogHeader>
            <form
              action={formAction}
              className="flex flex-col gap-5"
              noValidate
            >
              {state.error ? (
                <Alert variant="destructive">
                  <CircleAlertIcon />
                  <AlertDescription>{state.error}</AlertDescription>
                </Alert>
              ) : null}
              <input name="supplierId" type="hidden" value={supplierId} />
              <input name="masterItemId" type="hidden" value={masterItemId} />
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="label-box-packing-date">
                    Packing Date
                  </FieldLabel>
                  <Input
                    defaultValue={todayIsoDate()}
                    id="label-box-packing-date"
                    name="packingDate"
                    required
                    type="date"
                  />
                  <FieldDescription>
                    Dicetak di atas baris Delivery Date pada label.
                  </FieldDescription>
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="label-box-dn">
                      Delivery Number
                    </FieldLabel>
                    <Input
                      id="label-box-dn"
                      maxLength={100}
                      name="deliveryNumber"
                      placeholder="DN-2026-0001"
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="label-box-date">
                      Tanggal Delivery Number
                    </FieldLabel>
                    <Input
                      id="label-box-date"
                      name="deliveryDate"
                      required
                      type="date"
                    />
                  </Field>
                </div>

                <Field>
                  <FieldLabel htmlFor="label-box-supplier">
                    Kode Supplier
                  </FieldLabel>
                  <Select
                    onValueChange={(value) => {
                      setSupplierId(value)
                      setMasterItemId("")
                    }}
                    value={supplierId}
                  >
                    <SelectTrigger className="w-full" id="label-box-supplier">
                      <SelectValue placeholder="Pilih kode supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.supplierCode}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="label-box-master-item">
                    Master Item / Part No
                  </FieldLabel>
                  <Select
                    key={supplierId}
                    onValueChange={setMasterItemId}
                    value={masterItemId}
                  >
                    <SelectTrigger
                      className="w-full"
                      id="label-box-master-item"
                    >
                      <SelectValue placeholder="Pilih Part No" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredMasterItems.length === 0 ? (
                        <div className="text-muted-foreground px-2 py-1.5 text-sm">
                          Tidak ada Master Item ber-Box untuk supplier ini.
                        </div>
                      ) : (
                        filteredMasterItems.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.partNo}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </Field>

                {/* Packing Qty yang menentukan berapa label dicetak; Qty
                    Delivery hanya angka yang tercetak di labelnya. Keduanya
                    berdampingan supaya operator melihat bahwa keduanya memang
                    dua angka, bukan satu yang tertulis dua kali. */}
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="label-box-packing-qty">
                      Packing Qty
                    </FieldLabel>
                    <Input
                      id="label-box-packing-qty"
                      inputMode="numeric"
                      name="packingQty"
                      placeholder="100"
                      required
                    />
                    <FieldDescription>
                      {selectedMasterItem
                        ? `Kelipatan ${selectedMasterItem.packingQty}. Tiap ${selectedMasterItem.packingQty} menghasilkan satu set label.`
                        : "Harus kelipatan Qty/Box Master Item."}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="label-box-qty-delivery">
                      Qty Delivery
                    </FieldLabel>
                    <Input
                      id="label-box-qty-delivery"
                      inputMode="numeric"
                      name="qtyDelivery"
                      placeholder="100"
                      required
                    />
                    <FieldDescription>
                      Dicetak di baris Qty/Delivery label.
                    </FieldDescription>
                  </Field>
                </div>

                <Field>
                  <FieldLabel htmlFor="label-box-lot">Lot Number</FieldLabel>
                  <Input
                    id="label-box-lot"
                    maxLength={100}
                    name="lotNo"
                    placeholder="LOT-2026-07-001"
                    required
                  />
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button onClick={closeDialog} type="button" variant="outline">
                  Batal
                </Button>
                <Button
                  disabled={isPending || !supplierId || !masterItemId}
                  type="submit"
                >
                  {isPending ? <Spinner data-icon="inline-start" /> : null}
                  Simpan
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function GeneratedStep({
  onFinish,
  result,
}: {
  onFinish: () => void
  result: LabelBoxBatchResult
}) {
  const samplePayload = result.labelBoxes[0]?.qrPayload ?? ""
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!samplePayload) return
    let cancelled = false
    QRCode.toDataURL(samplePayload, { margin: 1, width: 120 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url)
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [samplePayload])

  return (
    <>
      <DialogHeader>
        <DialogTitle>{result.labelCount} label box dibuat</DialogTitle>
        <DialogDescription>
          {result.deliveryNumber} · {result.supplierCode} · {result.itemCode} ·
          Lot {result.lotNo}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-5">
        <div>
          <p className="mb-2 text-sm font-medium">Nomor box</p>
          <div className="flex flex-wrap gap-2">
            {result.labelBoxes.map((labelBox) => (
              <span
                className="bg-muted rounded-md px-2 py-1 font-mono text-sm"
                key={labelBox.boxNumber}
              >
                {labelBox.boxNumber}
              </span>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <PackageCheckIcon className="size-4" />
            <p className="text-sm font-medium">QR tergenerate</p>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`QR ${result.labelBoxes[0]?.boxNumber ?? ""}`}
                className="rounded-md border"
                height={120}
                src={qrDataUrl}
                width={120}
              />
            ) : (
              <div className="size-[120px] rounded-md border" />
            )}
            <div className="grid flex-1 gap-1">
              {result.labelBoxes.map((labelBox) => (
                <p
                  className="text-muted-foreground font-mono text-xs break-all"
                  key={labelBox.boxNumber}
                >
                  {labelBox.qrPayload}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button onClick={onFinish} type="button">
          Selesai
        </Button>
      </DialogFooter>
    </>
  )
}
