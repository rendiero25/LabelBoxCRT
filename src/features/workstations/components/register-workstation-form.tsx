"use client"

import { useActionState } from "react"
import { CircleAlertIcon, CopyIcon, PlusIcon } from "lucide-react"

import { registerWorkstationAction } from "@/features/workstations/actions"
import { initialWorkstationActionState } from "@/features/workstations/form-state"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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

type Operator = { id: string; display_name: string }

export function RegisterWorkstationForm({
  operators,
}: {
  operators: Operator[]
}) {
  const [state, formAction, isPending] = useActionState(
    registerWorkstationAction,
    initialWorkstationActionState,
  )
  useActionStateToast(state)

  return (
    <form
      action={formAction}
      className="flex max-w-3xl flex-col gap-5"
      noValidate
    >
      {state.error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Registrasi gagal</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {state.enrollmentCode ? (
        <Alert>
          <CopyIcon />
          <AlertTitle>Simpan kode enrollment sekarang</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <code className="bg-muted overflow-x-auto rounded-md px-2 py-1 text-xs break-all">
              {state.enrollmentCode}
            </code>
            <span>
              Satu kali pakai, berlaku sampai{" "}
              {new Date(state.enrollmentExpiresAt ?? "").toLocaleString(
                "id-ID",
              )}
              . Operator membuka <code>/workstation/enroll</code> pada PC
              tujuan, lalu admin menyetujui workstation.
            </span>
          </AlertDescription>
        </Alert>
      ) : null}

      <FieldGroup>
        <div className="grid gap-5 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="workstationCode">Kode workstation</FieldLabel>
            <Input
              id="workstationCode"
              maxLength={64}
              name="workstationCode"
              placeholder="LINE-A-01"
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="name">Nama workstation</FieldLabel>
            <Input
              id="name"
              maxLength={120}
              name="name"
              placeholder="Line A Packing"
              required
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="operatorId">Operator yang ditugaskan</FieldLabel>
          <Select name="operatorId" required>
            <SelectTrigger id="operatorId" className="w-full">
              <SelectValue placeholder="Pilih operator aktif" />
            </SelectTrigger>
            <SelectContent>
              {operators.map((operator) => (
                <SelectItem key={operator.id} value={operator.id}>
                  {operator.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Operator ini saja yang dapat enrollment dan memakai workstation.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="printerName">Nama printer Windows</FieldLabel>
          <Input
            id="printerName"
            maxLength={255}
            name="printerName"
            placeholder="ZDesigner ZD220-203dpi ZPL"
            required
          />
          <FieldDescription>
            Harus sama persis dengan nama printer yang terdeteksi QZ Tray.
          </FieldDescription>
        </Field>
        <div className="grid gap-5 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="printerModel">Model printer</FieldLabel>
            <Input
              defaultValue="Zebra ZD220"
              id="printerModel"
              maxLength={120}
              name="printerModel"
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="scannerModel">Model scanner</FieldLabel>
            <Input
              defaultValue="Zebra DS2208 2D"
              id="scannerModel"
              maxLength={120}
              name="scannerModel"
              required
            />
          </Field>
        </div>
      </FieldGroup>

      <Button disabled={isPending || operators.length === 0} type="submit">
        {isPending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <PlusIcon data-icon="inline-start" />
        )}
        Daftarkan workstation
      </Button>
    </form>
  )
}
