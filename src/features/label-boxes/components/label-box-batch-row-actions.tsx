"use client"

import { useActionState, useState } from "react"
import { PencilIcon, Trash2Icon } from "lucide-react"

import {
  deleteLabelBoxBatchAction,
  updateLabelBoxBatchAction,
} from "@/features/label-boxes/actions"
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
import { Spinner } from "@/components/ui/spinner"

export type LabelBoxBatchEditable = {
  deliveryDate: string
  deliveryNumber: string
  id: string
  labelCount: number
  lotNo: string
  partNo: string
}

/**
 * Supplier, Master Item, dan Qty Delivery tidak ada di sini: ketiganya yang
 * menentukan berapa banyak dan nomor berapa saja label boxnya, jadi mengubahnya
 * berarti membuat batch baru. Yang tersisa hanya keterangan kirimannya.
 */
export function EditLabelBoxBatchDialog({
  batch,
}: {
  batch: LabelBoxBatchEditable
}) {
  const [state, formAction, isPending] = useActionState(
    updateLabelBoxBatchAction,
    initialLabelBoxBatchActionState,
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit label box {batch.deliveryNumber}</DialogTitle>
          <DialogDescription>
            {batch.partNo} · {batch.labelCount} box. Nomor box tetap, QR tiap
            box dibuat ulang mengikuti data baru.
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
          <FieldGroup>
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
          </FieldGroup>
          <DialogFooter>
            <Button
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              Batal
            </Button>
            <Button disabled={isPending} type="submit">
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
