"use client"

import { useActionState, useMemo, useState } from "react"
import {
  BanIcon,
  CheckIcon,
  CircleAlertIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"

import {
  closeOrCancelDeliveryNumberAction,
  createDeliveryNumberAction,
  updateDeliveryNumberAction,
} from "@/features/delivery-numbers/actions"
import { initialDeliveryNumberActionState } from "@/features/delivery-numbers/form-state"
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
import { Badge } from "@/components/ui/badge"
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type DeliveryStatus = "draft" | "active" | "closed" | "cancelled"

type Supplier = {
  id: string
  supplier_code: string
  supplier_name: string
  is_active: boolean
}

type DeliveryNumber = {
  id: string
  supplier_id: string
  delivery_number: string
  delivery_date: string
  status: DeliveryStatus
}

const statusLabels: Record<DeliveryStatus, string> = {
  draft: "Draft",
  active: "Aktif",
  closed: "Closed",
  cancelled: "Cancelled",
}

export function DeliveryNumberDirectory({
  deliveryNumbers,
  suppliers,
}: {
  deliveryNumbers: DeliveryNumber[]
  suppliers: Supplier[]
}) {
  const [query, setQuery] = useState("")
  const [supplierId, setSupplierId] = useState("all")
  const [status, setStatus] = useState<"all" | DeliveryStatus>("all")
  const suppliersById = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier])),
    [suppliers],
  )
  const filteredDeliveryNumbers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("id-ID")

    return deliveryNumbers.filter((deliveryNumber) => {
      const supplier = suppliersById.get(deliveryNumber.supplier_id)
      const matchesQuery =
        !normalizedQuery ||
        deliveryNumber.delivery_number
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery) ||
        supplier?.supplier_code
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery) ||
        supplier?.supplier_name
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery)
      const matchesSupplier =
        supplierId === "all" || deliveryNumber.supplier_id === supplierId
      const matchesStatus = status === "all" || deliveryNumber.status === status

      return matchesQuery && matchesSupplier && matchesStatus
    })
  }, [deliveryNumbers, query, status, supplierId, suppliersById])
  const activeSuppliers = suppliers.filter((supplier) => supplier.is_active)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="grid gap-3 md:grid-cols-[minmax(16rem,22rem)_12rem_10rem]">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2 left-2.5 size-4" />
            <Input
              aria-label="Cari Delivery Number"
              className="pl-8"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari nomor atau supplier"
              value={query}
            />
          </div>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger aria-label="Filter supplier" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua supplier</SelectItem>
              {suppliers.map((supplier) => (
                <SelectItem key={supplier.id} value={supplier.id}>
                  {supplier.supplier_code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(value) =>
              setStatus(value as "all" | DeliveryStatus)
            }
          >
            <SelectTrigger aria-label="Filter status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              {Object.entries(statusLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <CreateDeliveryNumberDialog suppliers={activeSuppliers} />
      </div>

      {filteredDeliveryNumbers.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Tidak ada Delivery Number</EmptyTitle>
            <EmptyDescription>
              Ubah filter atau buat Delivery Number untuk supplier aktif.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Delivery Number</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDeliveryNumbers.map((deliveryNumber) => {
                const supplier = suppliersById.get(deliveryNumber.supplier_id)
                const isTerminal =
                  deliveryNumber.status === "closed" ||
                  deliveryNumber.status === "cancelled"

                return (
                  <TableRow key={deliveryNumber.id}>
                    <TableCell className="font-medium">
                      {deliveryNumber.delivery_number}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span>
                          {supplier?.supplier_code ??
                            "Supplier tidak ditemukan"}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {supplier?.supplier_name ?? ""}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {new Date(
                        `${deliveryNumber.delivery_date}T00:00:00`,
                      ).toLocaleDateString("id-ID")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          deliveryNumber.status === "active"
                            ? "secondary"
                            : deliveryNumber.status === "cancelled"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {statusLabels[deliveryNumber.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {!isTerminal ? (
                        <div className="flex items-start gap-2">
                          <EditDeliveryNumberDialog
                            deliveryNumber={deliveryNumber}
                            suppliers={activeSuppliers}
                          />
                          <TerminalDeliveryNumberActions
                            deliveryNumberId={deliveryNumber.id}
                          />
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          Status terminal
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function CreateDeliveryNumberDialog({ suppliers }: { suppliers: Supplier[] }) {
  const [state, formAction, isPending] = useActionState(
    createDeliveryNumberAction,
    initialDeliveryNumberActionState,
  )

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={suppliers.length === 0}>
          <PlusIcon data-icon="inline-start" />
          Delivery Number baru
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Buat Delivery Number</DialogTitle>
          <DialogDescription>
            Hanya supplier aktif yang dapat menerima Delivery Number baru.
          </DialogDescription>
        </DialogHeader>
        <DeliveryNumberForm
          action={formAction}
          error={state.error}
          isPending={isPending}
          submitLabel="Buat Delivery Number"
          suppliers={suppliers}
          withInitialStatus
        />
      </DialogContent>
    </Dialog>
  )
}

function EditDeliveryNumberDialog({
  deliveryNumber,
  suppliers,
}: {
  deliveryNumber: DeliveryNumber
  suppliers: Supplier[]
}) {
  const [state, formAction, isPending] = useActionState(
    updateDeliveryNumberAction,
    initialDeliveryNumberActionState,
  )

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
          <DialogTitle>Edit Delivery Number</DialogTitle>
          <DialogDescription>
            Tutup atau batalkan lewat aksi terpisah. Status terminal tidak dapat
            diubah kembali.
          </DialogDescription>
        </DialogHeader>
        <DeliveryNumberForm
          action={formAction}
          deliveryNumber={deliveryNumber}
          error={state.error}
          isPending={isPending}
          submitLabel="Simpan perubahan"
          suppliers={suppliers}
        />
      </DialogContent>
    </Dialog>
  )
}

function DeliveryNumberForm({
  action,
  deliveryNumber,
  error,
  isPending,
  submitLabel,
  suppliers,
  withInitialStatus = false,
}: {
  action: (formData: FormData) => void
  deliveryNumber?: DeliveryNumber
  error?: string
  isPending: boolean
  submitLabel: string
  suppliers: Supplier[]
  withInitialStatus?: boolean
}) {
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {deliveryNumber ? (
        <input
          name="deliveryNumberId"
          type="hidden"
          value={deliveryNumber.id}
        />
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
            htmlFor={
              deliveryNumber ? `supplierId-${deliveryNumber.id}` : "supplierId"
            }
          >
            Supplier
          </FieldLabel>
          <Select
            defaultValue={deliveryNumber?.supplier_id}
            name="supplierId"
            required
          >
            <SelectTrigger
              className="w-full"
              id={
                deliveryNumber
                  ? `supplierId-${deliveryNumber.id}`
                  : "supplierId"
              }
            >
              <SelectValue placeholder="Pilih supplier aktif" />
            </SelectTrigger>
            <SelectContent>
              {suppliers.map((supplier) => (
                <SelectItem key={supplier.id} value={supplier.id}>
                  {supplier.supplier_code} — {supplier.supplier_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel
            htmlFor={
              deliveryNumber
                ? `deliveryNumber-${deliveryNumber.id}`
                : "deliveryNumber"
            }
          >
            Delivery Number
          </FieldLabel>
          <Input
            defaultValue={deliveryNumber?.delivery_number}
            id={
              deliveryNumber
                ? `deliveryNumber-${deliveryNumber.id}`
                : "deliveryNumber"
            }
            maxLength={100}
            name="deliveryNumber"
            placeholder="DEV-DN-001"
            required
          />
        </Field>
        <Field>
          <FieldLabel
            htmlFor={
              deliveryNumber
                ? `deliveryDate-${deliveryNumber.id}`
                : "deliveryDate"
            }
          >
            Tanggal delivery
          </FieldLabel>
          <Input
            defaultValue={deliveryNumber?.delivery_date}
            id={
              deliveryNumber
                ? `deliveryDate-${deliveryNumber.id}`
                : "deliveryDate"
            }
            name="deliveryDate"
            required
            type="date"
          />
        </Field>
        {withInitialStatus ? (
          <Field>
            <FieldLabel htmlFor="status">Status awal</FieldLabel>
            <Select defaultValue="draft" name="status">
              <SelectTrigger className="w-full" id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Aktif</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        ) : null}
      </FieldGroup>
      <DialogFooter>
        <Button disabled={isPending || suppliers.length === 0} type="submit">
          {isPending ? <Spinner data-icon="inline-start" /> : null}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

function TerminalDeliveryNumberActions({
  deliveryNumberId,
}: {
  deliveryNumberId: string
}) {
  const [state, formAction, isPending] = useActionState(
    closeOrCancelDeliveryNumberAction,
    initialDeliveryNumberActionState,
  )

  return (
    <div className="flex flex-col items-start gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="outline">
            <CheckIcon data-icon="inline-start" />
            Close
          </Button>
        </AlertDialogTrigger>
        <DeliveryNumberTerminalDialog
          action={formAction}
          deliveryNumberId={deliveryNumberId}
          isPending={isPending}
          status="closed"
        />
      </AlertDialog>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive">
            <XIcon data-icon="inline-start" />
            Cancel
          </Button>
        </AlertDialogTrigger>
        <DeliveryNumberTerminalDialog
          action={formAction}
          deliveryNumberId={deliveryNumberId}
          isPending={isPending}
          status="cancelled"
        />
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

function DeliveryNumberTerminalDialog({
  action,
  deliveryNumberId,
  isPending,
  status,
}: {
  action: (formData: FormData) => void
  deliveryNumberId: string
  isPending: boolean
  status: "closed" | "cancelled"
}) {
  const isCancellation = status === "cancelled"

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {isCancellation ? "Batalkan" : "Tutup"} Delivery Number?
        </AlertDialogTitle>
        <AlertDialogDescription>
          Aksi ini bersifat terminal. Delivery Number tidak dapat diedit atau
          diaktifkan kembali.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <form action={action}>
        <input name="deliveryNumberId" type="hidden" value={deliveryNumberId} />
        <input name="status" type="hidden" value={status} />
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <Button
            disabled={isPending}
            type="submit"
            variant={isCancellation ? "destructive" : "default"}
          >
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {isCancellation ? <BanIcon data-icon="inline-start" /> : null}
            {isCancellation ? "Batalkan" : "Tutup"}
          </Button>
        </AlertDialogFooter>
      </form>
    </AlertDialogContent>
  )
}
