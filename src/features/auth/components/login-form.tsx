"use client"

import { useActionState } from "react"
import { CircleAlertIcon, LockKeyholeIcon } from "lucide-react"

import { signInAction } from "@/app/(auth)/login/actions"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { initialLoginActionState } from "@/features/auth/form-state"

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(
    signInAction,
    initialLoginActionState,
  )

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Masuk gagal</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <Field data-invalid={state.error ? true : undefined}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            autoComplete="email"
            autoFocus
            id="email"
            maxLength={254}
            name="email"
            required
            type="email"
          />
        </Field>
        <Field data-invalid={state.error ? true : undefined}>
          <FieldLabel htmlFor="password">Kata sandi</FieldLabel>
          <Input
            autoComplete="current-password"
            id="password"
            maxLength={1024}
            name="password"
            required
            type="password"
          />
        </Field>
      </FieldGroup>

      <Button className="w-full" disabled={isPending} size="lg" type="submit">
        {isPending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <LockKeyholeIcon data-icon="inline-start" />
        )}
        Masuk
      </Button>
    </form>
  )
}
