"use client"

import { useActionState } from "react"
import { CircleAlertIcon, KeyRoundIcon } from "lucide-react"

import { enrollWorkstationAction } from "@/features/workstations/actions"
import { initialWorkstationActionState } from "@/features/workstations/form-state"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

export function EnrollWorkstationForm() {
  const [state, formAction, isPending] = useActionState(
    enrollWorkstationAction,
    initialWorkstationActionState,
  )

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Enrollment gagal</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {state.success ? (
        <Alert>
          <KeyRoundIcon />
          <AlertTitle>Browser terdaftar</AlertTitle>
          <AlertDescription>{state.success}</AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="enrollmentCode">Kode enrollment</FieldLabel>
          <Input
            autoComplete="one-time-code"
            autoFocus
            id="enrollmentCode"
            maxLength={64}
            name="enrollmentCode"
            required
            spellCheck={false}
          />
          <FieldDescription>
            Kode hanya berlaku sekali. Jangan simpan di browser atau
            localStorage.
          </FieldDescription>
        </Field>
      </FieldGroup>
      <Button disabled={isPending} type="submit">
        {isPending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <KeyRoundIcon data-icon="inline-start" />
        )}
        Daftarkan browser ini
      </Button>
    </form>
  )
}
