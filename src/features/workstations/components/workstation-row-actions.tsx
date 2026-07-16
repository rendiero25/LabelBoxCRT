"use client"

import { useActionState } from "react"
import { BanIcon, CheckIcon, CircleAlertIcon } from "lucide-react"

import {
  approveWorkstationAction,
  disableWorkstationAction,
} from "@/features/workstations/actions"
import { initialWorkstationActionState } from "@/features/workstations/form-state"
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

export function WorkstationRowActions({
  workstationId,
  approvalStatus,
  hasActiveDevice,
}: {
  workstationId: string
  approvalStatus: "pending" | "approved" | "disabled"
  hasActiveDevice: boolean
}) {
  const [approveState, approveAction, isApproving] = useActionState(
    approveWorkstationAction,
    initialWorkstationActionState,
  )
  const [disableState, disableAction, isDisabling] = useActionState(
    disableWorkstationAction,
    initialWorkstationActionState,
  )

  if (approvalStatus === "disabled") return null

  return (
    <div className="flex flex-col items-start gap-2">
      {approvalStatus === "pending" ? (
        <form action={approveAction}>
          <input name="workstationId" type="hidden" value={workstationId} />
          <Button
            disabled={isApproving || !hasActiveDevice}
            size="sm"
            type="submit"
          >
            {isApproving ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <CheckIcon data-icon="inline-start" />
            )}
            Setujui
          </Button>
        </form>
      ) : null}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive">
            <BanIcon data-icon="inline-start" />
            Nonaktifkan
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nonaktifkan workstation?</AlertDialogTitle>
            <AlertDialogDescription>
              Token browser aktif langsung dicabut. Session dan print masa depan
              akan ditolak.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form action={disableAction} className="flex flex-col gap-4">
            <input name="workstationId" type="hidden" value={workstationId} />
            <Field>
              <FieldLabel htmlFor={`reason-${workstationId}`}>
                Alasan
              </FieldLabel>
              <Input
                id={`reason-${workstationId}`}
                maxLength={500}
                name="reason"
                required
              />
            </Field>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <Button
                disabled={isDisabling}
                type="submit"
                variant="destructive"
              >
                {isDisabling ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <BanIcon data-icon="inline-start" />
                )}
                Nonaktifkan
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      {approveState.error || disableState.error ? (
        <Alert className="max-w-xs" variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>
            {approveState.error ?? disableState.error}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
