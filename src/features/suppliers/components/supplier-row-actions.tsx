"use client"

import { useActionState, useState } from "react"
import { BanIcon, CheckIcon, CircleAlertIcon } from "lucide-react"

import { setSupplierActiveAction } from "@/features/suppliers/actions"
import { initialSupplierActionState } from "@/features/suppliers/form-state"
import {
  useActionStateToast,
  useCloseOnActionSuccess,
} from "@/components/shared/action-state-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

export function SupplierRowActions({
  supplierId,
  isActive,
}: {
  supplierId: string
  isActive: boolean
}) {
  const [state, formAction, isPending] = useActionState(
    setSupplierActiveAction,
    initialSupplierActionState,
  )
  useActionStateToast(state)
  const [open, setOpen] = useState(false)
  useCloseOnActionSuccess(state, () => setOpen(false))
  const actionLabel = isActive ? "Nonaktifkan" : "Aktifkan"

  return (
    <div className="flex flex-col items-start gap-2">
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant={isActive ? "destructive" : "outline"}>
            {isActive ? (
              <BanIcon data-icon="inline-start" />
            ) : (
              <CheckIcon data-icon="inline-start" />
            )}
            {actionLabel}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{actionLabel} supplier?</AlertDialogTitle>
            <AlertDialogDescription>
              {isActive
                ? "Supplier tidak dihapus. Riwayat Delivery Number yang sudah terhubung tetap aman."
                : "Supplier dapat dipakai lagi untuk Delivery Number setelah diaktifkan."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form action={formAction}>
            <input name="supplierId" type="hidden" value={supplierId} />
            <input name="isActive" type="hidden" value={String(!isActive)} />
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <Button
                disabled={isPending}
                type="submit"
                variant={isActive ? "destructive" : "default"}
              >
                {isPending ? <Spinner data-icon="inline-start" /> : null}
                {actionLabel}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
      {state.error ? (
        <Alert className="max-w-xs" variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
