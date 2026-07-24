"use client"

import { useActionState, useState } from "react"
import { CircleAlertIcon, PlusIcon } from "lucide-react"

import { createDeliveryNumberAction } from "@/features/delivery-numbers/actions"
import { initialDeliveryNumberActionState } from "@/features/delivery-numbers/form-state"
import {
  useActionStateToast,
  useCloseOnActionSuccess,
} from "@/components/shared/action-state-toast"
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"

export type CreateDeliveryNumberSupplier = {
  id: string
  supplierCode: string
  supplierName: string
}

export function CreateDeliveryNumberDialog({
  suppliers,
}: {
  suppliers: CreateDeliveryNumberSupplier[]
}) {
  const [state, formAction, isPending] = useActionState(
    createDeliveryNumberAction,
    initialDeliveryNumberActionState,
  )
  useActionStateToast(state)
  const [open, setOpen] = useState(false)
  useCloseOnActionSuccess(state, () => setOpen(false))

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button disabled={suppliers.length === 0} type="button" variant="outline">
          <PlusIcon data-icon="inline-start" />
          Buat Delivery Number
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Buat Delivery Number</DialogTitle>
          <DialogDescription>
            Delivery Number baru langsung berstatus aktif dan siap dipilih.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-5" noValidate>
          <input name="status" type="hidden" value="active" />
          {state.error ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="scan-dn-supplier">Supplier</FieldLabel>
              <Select name="supplierId" required>
                <SelectTrigger className="w-full" id="scan-dn-supplier">
                  <SelectValue placeholder="Pilih supplier aktif" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.supplierCode} — {supplier.supplierName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="scan-dn-number">Delivery Number</FieldLabel>
              <Input
                id="scan-dn-number"
                maxLength={100}
                name="deliveryNumber"
                placeholder="DEV-DN-001"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="scan-dn-date">Tanggal delivery</FieldLabel>
              <Input id="scan-dn-date" name="deliveryDate" required type="date" />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button disabled={isPending || suppliers.length === 0} type="submit">
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              Buat Delivery Number
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
