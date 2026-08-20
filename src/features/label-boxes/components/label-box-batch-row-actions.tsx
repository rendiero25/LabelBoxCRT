"use client"

import { useActionState, useMemo, useState } from "react"
import { PencilIcon, Trash2Icon } from "lucide-react"

import {
  deleteLabelBoxBatchAction,
  rebuildLabelBoxBatchAction,
  updateLabelBoxBatchAction,
} from "@/features/label-boxes/actions"
import type {
  LabelBoxMasterItemOption,
  LabelBoxSupplierOption,
} from "@/features/label-boxes/components/label-box-batch-dialog"
import { initialLabelBoxBatchActionState } from "@/features/label-boxes/form-state"
import {
  useActionStateToast,
  useCloseOnActionSuccess,
} from "@/components/shared/action-state-toast"
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

export type LabelBoxBatchEditable = {
  closed: boolean
  deliveryDate: string
  deliveryNumber: string
  id: string
  labelCount: number
  lotNo: string
  masterItemId: string
  operatorName: string
  packingDate: string
  packingQty: number
  partNo: string
  qtyDelivery: number
  supplierId: string
}

/**
 * Batch yang belum ditutup boleh disunting seluruhnya — termasuk supplier,
 * Master Item, dan kedua angka Qty. Ketiganya menentukan berapa banyak nomor
 * box yang ada, jadi menggantinya berarti nomor box lama dibuang dan dirakit
 * ulang: scannya mulai lagi dari awal dengan data yang baru. Itu memang yang
 * dibutuhkan ketika kesalahan datanya baru ketahuan di tengah verifikasi.
 *
 * Batch yang verifikasinya sudah selesai hanya menerima keterangan kirimannya:
 * labelnya sudah tercetak dan menempel di box, dan hasil scannya bukti kiriman.
 */
export function EditLabelBoxBatchDialog({
  batch,
  masterItems,
  suppliers,
}: {
  batch: LabelBoxBatchEditable
  masterItems: LabelBoxMasterItemOption[]
  suppliers: LabelBoxSupplierOption[]
}) {
  const [state, formAction, isPending] = useActionState(
    batch.closed ? updateLabelBoxBatchAction : rebuildLabelBoxBatchAction,
    initialLabelBoxBatchActionState,
  )
  const [supplierId, setSupplierId] = useState(batch.supplierId)
  const [masterItemId, setMasterItemId] = useState(batch.masterItemId)

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
  useActionStateToast(state)
  const [open, setOpen] = useState(false)
  useCloseOnActionSuccess(state, () => setOpen(false))

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <PencilIcon data-icon="inline-start" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit label box {batch.deliveryNumber}</DialogTitle>
          <DialogDescription>
            {batch.partNo} · {batch.labelCount} box.{" "}
            {batch.closed
              ? "Verifikasi sudah selesai, jadi hanya keterangan kiriman yang bisa diubah. Nomor box tetap, QR tiap box dibuat ulang mengikuti data baru."
              : "Seluruh data bisa diubah. Nomor box dan QR dibuat ulang, dan scan yang sudah masuk dihapus supaya verifikasinya dimulai lagi dari awal dengan data baru."}
          </DialogDescription>
        </DialogHeader>
        {/* Dialog yang tertutup melepas isinya, jadi form baru selalu mulai
            dari nilai batch yang tersimpan; defaultValue sudah cukup. */}
        <form action={formAction} className="flex flex-col gap-5" noValidate>
          {state.error ? (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <input name="batchId" type="hidden" value={batch.id} />
          {batch.closed ? null : (
            <>
              <input name="supplierId" type="hidden" value={supplierId} />
              <input name="masterItemId" type="hidden" value={masterItemId} />
            </>
          )}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`edit-packing-date-${batch.id}`}>
                Packing Date
              </FieldLabel>
              <Input
                defaultValue={batch.packingDate.slice(0, 10)}
                id={`edit-packing-date-${batch.id}`}
                name="packingDate"
                required
                type="date"
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`edit-dn-${batch.id}`}>
                  Delivery Number
                </FieldLabel>
                <Input
                  defaultValue={batch.deliveryNumber}
                  id={`edit-dn-${batch.id}`}
                  maxLength={100}
                  name="deliveryNumber"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`edit-date-${batch.id}`}>
                  Tanggal Delivery Number
                </FieldLabel>
                <Input
                  defaultValue={batch.deliveryDate.slice(0, 10)}
                  id={`edit-date-${batch.id}`}
                  name="deliveryDate"
                  required
                  type="date"
                />
                <FieldDescription>
                  Tanggal milik Delivery Number. Tidak bisa diubah dari sini
                  kalau nomor itu dipakai batch lain.
                </FieldDescription>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor={`edit-lot-${batch.id}`}>
                Lot Number
              </FieldLabel>
              <Input
                defaultValue={batch.lotNo}
                id={`edit-lot-${batch.id}`}
                maxLength={100}
                name="lotNo"
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor={`edit-operator-${batch.id}`}>
                Nama Operator
              </FieldLabel>
              <Input
                defaultValue={batch.operatorName}
                id={`edit-operator-${batch.id}`}
                maxLength={100}
                name="operatorName"
                required
              />
              <FieldDescription>
                Dicetak di baris Operator Pack label.
              </FieldDescription>
            </Field>

            {batch.closed ? null : (
              <>
                <Field>
                  <FieldLabel htmlFor={`edit-supplier-${batch.id}`}>
                    Kode Supplier
                  </FieldLabel>
                  <Select
                    onValueChange={(value) => {
                      setSupplierId(value)
                      // Master Item milik supplier lain tidak boleh ikut
                      // terbawa saat suppliernya diganti.
                      const stillFits = masterItems.some(
                        (item) =>
                          item.id === masterItemId &&
                          (item.supplierId === null ||
                            item.supplierId === value),
                      )
                      if (!stillFits) setMasterItemId("")
                    }}
                    value={supplierId}
                  >
                    <SelectTrigger id={`edit-supplier-${batch.id}`}>
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
                  <FieldLabel htmlFor={`edit-master-item-${batch.id}`}>
                    Part No
                  </FieldLabel>
                  <Select onValueChange={setMasterItemId} value={masterItemId}>
                    <SelectTrigger id={`edit-master-item-${batch.id}`}>
                      <SelectValue placeholder="Pilih Part No" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredMasterItems.length === 0 ? (
                        <SelectItem disabled value="none">
                          Tidak ada Master Item untuk supplier ini
                        </SelectItem>
                      ) : (
                        // Sama seperti dialog Tambah: yang belum punya Box tetap
                        // terlihat, tapi tidak bisa dipilih.
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

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor={`edit-qty-delivery-${batch.id}`}>
                      Qty Delivery
                    </FieldLabel>
                    <Input
                      defaultValue={batch.packingQty}
                      id={`edit-qty-delivery-${batch.id}`}
                      inputMode="numeric"
                      name="packingQty"
                      required
                    />
                    <FieldDescription>
                      {selectedMasterItem
                        ? `Kelipatan ${selectedMasterItem.packingQty}. Tiap ${selectedMasterItem.packingQty} menghasilkan satu set label.`
                        : "Harus kelipatan Qty/Box Master Item."}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`edit-packing-qty-${batch.id}`}>
                      Packing Qty
                    </FieldLabel>
                    <Input
                      defaultValue={batch.qtyDelivery}
                      id={`edit-packing-qty-${batch.id}`}
                      inputMode="numeric"
                      name="qtyDelivery"
                      required
                    />
                    <FieldDescription>
                      Dicetak di baris Qty/Delivery label.
                    </FieldDescription>
                  </Field>
                </div>
              </>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              Batal
            </Button>
            <Button
              disabled={
                isPending || (!batch.closed && (!supplierId || !masterItemId))
              }
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

export function DeleteLabelBoxBatchAction({
  batch,
}: {
  batch: LabelBoxBatchEditable
}) {
  const [state, formAction, isPending] = useActionState(
    deleteLabelBoxBatchAction,
    initialLabelBoxBatchActionState,
  )
  useActionStateToast(state)
  const [open, setOpen] = useState(false)
  useCloseOnActionSuccess(state, () => setOpen(false))

  return (
    <AlertDialog onOpenChange={setOpen} open={open}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="destructive">
          <Trash2Icon data-icon="inline-start" />
          Hapus
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Hapus label box {batch.deliveryNumber}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Tindakan ini permanen. {batch.labelCount} nomor box beserta hasil
            scan dan riwayat cetaknya ikut terhapus, termasuk yang labelnya
            sudah tercetak dan menempel di box. Delivery Number-nya sendiri
            tetap ada.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {state.error ? (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}
        <form action={formAction}>
          <input name="batchId" type="hidden" value={batch.id} />
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <Button disabled={isPending} type="submit" variant="destructive">
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              Hapus
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
