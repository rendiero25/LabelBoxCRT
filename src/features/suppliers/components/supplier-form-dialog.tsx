"use client"

import { useActionState } from "react"
import { CircleAlertIcon, PencilIcon, PlusIcon } from "lucide-react"

import {
  createSupplierAction,
  updateSupplierAction,
} from "@/features/suppliers/actions"
import { initialSupplierActionState } from "@/features/suppliers/form-state"
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

type Supplier = {
  id: string
  supplier_code: string
  supplier_name: string
}

export function CreateSupplierDialog() {
  const [state, formAction, isPending] = useActionState(
    createSupplierAction,
    initialSupplierActionState,
  )
  useActionStateToast(state)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon data-icon="inline-start" />
          Supplier baru
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Buat supplier</DialogTitle>
          <DialogDescription>
            Kode supplier bersifat unik dan akan dipakai oleh Delivery Number.
          </DialogDescription>
        </DialogHeader>
        <SupplierForm
          action={formAction}
          error={state.error}
          isPending={isPending}
          submitLabel="Buat supplier"
        />
      </DialogContent>
    </Dialog>
  )
}

export function EditSupplierDialog({ supplier }: { supplier: Supplier }) {
  const [state, formAction, isPending] = useActionState(
    updateSupplierAction,
    initialSupplierActionState,
  )
  useActionStateToast(state)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <PencilIcon data-icon="inline-start" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit supplier</DialogTitle>
          <DialogDescription>
            Perubahan dicatat pada audit log. Supplier yang sudah dipakai tidak
            dapat dihapus.
          </DialogDescription>
        </DialogHeader>
        <SupplierForm
          action={formAction}
          error={state.error}
          isPending={isPending}
          submitLabel="Simpan perubahan"
          supplier={supplier}
        />
      </DialogContent>
    </Dialog>
  )
}

function SupplierForm({
  action,
  error,
  isPending,
  submitLabel,
  supplier,
}: {
  action: (formData: FormData) => void
  error?: string
  isPending: boolean
  submitLabel: string
  supplier?: Supplier
}) {
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {supplier ? (
        <input name="supplierId" type="hidden" value={supplier.id} />
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup>
        <Field>
          <FieldLabel
            htmlFor={supplier ? `supplierCode-${supplier.id}` : "supplierCode"}
          >
            Kode supplier
          </FieldLabel>
          <Input
            defaultValue={supplier?.supplier_code}
            id={supplier ? `supplierCode-${supplier.id}` : "supplierCode"}
            maxLength={64}
            name="supplierCode"
            placeholder="B101"
            required
          />
        </Field>
        <Field>
          <FieldLabel
            htmlFor={supplier ? `supplierName-${supplier.id}` : "supplierName"}
          >
            Nama supplier
          </FieldLabel>
          <Input
            defaultValue={supplier?.supplier_name}
            id={supplier ? `supplierName-${supplier.id}` : "supplierName"}
            maxLength={200}
            name="supplierName"
            placeholder="PT Contoh Supplier"
            required
          />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button disabled={isPending} type="submit">
          {isPending ? <Spinner data-icon="inline-start" /> : null}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
