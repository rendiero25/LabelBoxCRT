"use client"

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react"
import { usePathname, useRouter } from "next/navigation"
import { CircleAlertIcon, PlusIcon } from "lucide-react"

import { createLabelBoxBatchAction } from "@/features/label-boxes/actions"
import {
  initialLabelBoxBatchActionState,
  type LabelBoxBatchActionState,
} from "@/features/label-boxes/form-state"
import type { LabelBoxMasterItemOption } from "@/features/label-boxes/master-item-options"
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

export type { LabelBoxMasterItemOption }

/**
 * Menutup dialognya begitu satu batch berhasil dibuat.
 *
 * `state` dari `useActionState` hidup lebih lama daripada dialognya — komponen
 * pemiliknya tidak pernah dilepas — jadi `state.result` saja tidak bisa jadi
 * penanda: dialog yang dibuka lagi akan langsung menutup diri karena hasil
 * batch sebelumnya masih tersimpan di sana. Yang dipakai karena itu objek
 * state-nya, yang selalu baru pada tiap pengiriman form.
 *
 * Nomor box dan QR-nya tidak lagi ditampilkan di sini: keduanya sudah ada di
 * daftar label box tepat di belakang dialog ini, dan langkah tambahan yang
 * hanya perlu diklik "Selesai" berdiri di antara operator dan pekerjaannya.
 */
function useCloseOnNewResult(
  state: LabelBoxBatchActionState,
  onResult: () => void,
) {
  useEffect(() => {
    if (state.result) onResult()
    // Objek state-nya yang jadi penanda, bukan isinya: satu pengiriman form
    // menghasilkan satu objek baru, jadi efeknya berjalan sekali per batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])
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
  //
  // Master Item tanpa Box tidak mengisi apa pun walau alamatnya diketik tangan:
  // pilihannya sendiri dinonaktifkan, dan dialog yang terbuka dengan pilihan
  // yang tidak bisa disimpan lebih membingungkan daripada dialog yang tertutup.
  const prefillMasterItem =
    masterItems.find(
      (item) => item.id === prefillMasterItemId && item.hasBox,
    ) ?? null

  const [open, setOpen] = useState(prefillMasterItem !== null)
  const [supplierId, setSupplierId] = useState(
    prefillMasterItem?.supplierId ?? "",
  )
  const [masterItemId, setMasterItemId] = useState(prefillMasterItem?.id ?? "")

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

  const resetForm = useCallback(() => {
    setSupplierId("")
    setMasterItemId("")
    // Buang ?masterItemId dari URL supaya refresh atau tombol back tidak
    // membuka ulang dialog yang baru saja ditutup operator.
    if (prefillMasterItemId) router.replace(pathname)
  }, [pathname, prefillMasterItemId, router])

  const closeDialog = useCallback(() => {
    setOpen(false)
    resetForm()
  }, [resetForm])

  // Batch yang berhasil dibuat menutup dialognya sendiri; hasilnya sudah
  // diumumkan lewat toast dan sudah tampil di daftar label box di belakangnya.
  useCloseOnNewResult(state, closeDialog)

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
        <DialogHeader>
          <DialogTitle>Tambah label box</DialogTitle>
          <DialogDescription>
            Nomor box dan QR dibuat otomatis dari Qty Delivery dibagi Qty/Box
            Master Item.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-5" noValidate>
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
                <FieldLabel htmlFor="label-box-dn">Delivery Number</FieldLabel>
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
                <SelectTrigger className="w-full" id="label-box-master-item">
                  <SelectValue placeholder="Pilih Part No" />
                </SelectTrigger>
                <SelectContent>
                  {filteredMasterItems.length === 0 ? (
                    <div className="text-muted-foreground px-2 py-1.5 text-sm">
                      Tidak ada Master Item untuk supplier ini.
                    </div>
                  ) : (
                    // Master Item tanpa Box tetap terlihat supaya daftarnya sama
                    // dengan halaman admin, tetapi tidak bisa dipilih: label
                    // boxnya akan berjumlah nol.
                    filteredMasterItems.map((item) => (
                      <SelectItem
                        disabled={!item.hasBox}
                        key={item.id}
                        value={item.id}
                      >
                        {item.hasBox
                          ? item.partNo
                          : `${item.partNo} · belum punya Box`}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </Field>

            {/* Dua angka jumlah yang menjawab pertanyaan berbeda. Yang ini
                menentukan berapa banyak label dibuat; ia tidak tercetak di
                label mana pun. */}
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
                {selectedMasterItem
                  ? `Kelipatan ${selectedMasterItem.packingQty}. Tiap ${selectedMasterItem.packingQty} menghasilkan satu set label.`
                  : "Harus kelipatan Qty/Box Master Item. Menentukan jumlah set label."}
              </FieldDescription>
            </Field>

            {/* Angka kiriman yang dibaca orang dan mesin: tercetak di baris
                Qty/Delivery label sekaligus dibawa field ketiga QR. Bebas dari
                Qty/Box, jadi tidak perlu kelipatan apa pun. */}
            <Field>
              <FieldLabel htmlFor="label-box-packing-qty">
                Packing Qty
              </FieldLabel>
              <Input
                id="label-box-packing-qty"
                inputMode="numeric"
                name="qtyDeliveryDisplay"
                placeholder="5000"
                required
              />
              <FieldDescription>
                Tercetak di baris Qty/Delivery label dan dibawa QR-nya.
              </FieldDescription>
            </Field>

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

            <Field>
              <FieldLabel htmlFor="label-box-operator">
                Nama Operator
              </FieldLabel>
              <Input
                id="label-box-operator"
                maxLength={100}
                name="operatorName"
                placeholder="AD"
                required
              />
              <FieldDescription>
                Dicetak di baris Operator Pack label.
              </FieldDescription>
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
      </DialogContent>
    </Dialog>
  )
}
