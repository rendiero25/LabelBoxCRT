"use client"

import { useActionState, useMemo, useState } from "react"
import {
  BanIcon,
  CheckIcon,
  CircleAlertIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react"

import {
  createMasterItemAction,
  setMasterItemActiveAction,
  updateMasterItemAction,
} from "@/features/master-items/actions"
import {
  MasterItemBoxLayerEditor,
  type BoxOption,
  type MasterItemBoxAssignment,
  type ProductOption,
} from "@/features/master-items/components/master-item-box-layer-editor"
import { initialMasterItemActionState } from "@/features/master-items/form-state"
import { useActionStateToast } from "@/components/shared/action-state-toast"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type MasterItem = {
  id: string
  item_code: string
  part_no: string
  part_name: string
  unit: string
  default_label_qty: number
  item_sequence_code: string | null
  is_active: boolean
}

export function MasterItemDirectory({
  boxes,
  masterItemBoxes,
  masterItems,
  products,
}: {
  boxes: BoxOption[]
  masterItemBoxes: MasterItemBoxAssignment[]
  masterItems: MasterItem[]
  products: ProductOption[]
}) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all")
  const filteredMasterItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("id-ID")

    return masterItems.filter((masterItem) => {
      const matchesQuery =
        !normalizedQuery ||
        masterItem.item_code
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery) ||
        masterItem.part_no
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery) ||
        masterItem.part_name
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery)
      const matchesStatus =
        status === "all" ||
        (status === "active" ? masterItem.is_active : !masterItem.is_active)

      return matchesQuery && matchesStatus
    })
  }, [masterItems, query, status])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-3 sm:grid-cols-[minmax(16rem,24rem)_10rem]">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2 left-2.5 size-4" />
            <Input
              aria-label="Cari Master Item"
              className="pl-8"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari kode, Part No, atau nama"
              value={query}
            />
          </div>
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as typeof status)}
          >
            <SelectTrigger
              aria-label="Filter status Master Item"
              className="w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              <SelectItem value="active">Aktif</SelectItem>
              <SelectItem value="inactive">Nonaktif</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <CreateMasterItemDialog />
      </div>

      {filteredMasterItems.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Tidak ada Master Item</EmptyTitle>
            <EmptyDescription>
              Ubah pencarian/filter atau buat Master Item baru.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No</TableHead>
                <TableHead>Master Item</TableHead>
                <TableHead>Unit / Qty</TableHead>
                <TableHead>Sequence</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMasterItems.map((masterItem, index) => (
                <TableRow key={masterItem.id}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{masterItem.part_no}</span>
                      <span className="text-muted-foreground text-xs">
                        {masterItem.item_code} · {masterItem.part_name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {masterItem.unit} · Qty {masterItem.default_label_qty}
                  </TableCell>
                  <TableCell className="font-sans text-xs">
                    {masterItem.item_sequence_code ?? "Belum diatur"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={masterItem.is_active ? "secondary" : "outline"}
                    >
                      {masterItem.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-start gap-2">
                      <EditMasterItemDialog masterItem={masterItem} />
                      <MasterItemBoxLayerEditor
                        boxes={boxes}
                        masterItem={masterItem}
                        masterItemBoxes={masterItemBoxes}
                        products={products}
                      />
                      <MasterItemActiveAction
                        isActive={masterItem.is_active}
                        masterItemId={masterItem.id}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function CreateMasterItemDialog() {
  const [state, formAction, isPending] = useActionState(
    createMasterItemAction,
    initialMasterItemActionState,
  )
  useActionStateToast(state)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon data-icon="inline-start" />
          Master Item baru
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Buat Master Item</DialogTitle>
          <DialogDescription>
            Default label Qty berasal dari master data, bukan nilai aplikasi
            tetap.
          </DialogDescription>
        </DialogHeader>
        <MasterItemForm
          action={formAction}
          error={state.error}
          isPending={isPending}
          submitLabel="Buat Master Item"
        />
      </DialogContent>
    </Dialog>
  )
}

function EditMasterItemDialog({ masterItem }: { masterItem: MasterItem }) {
  const [state, formAction, isPending] = useActionState(
    updateMasterItemAction,
    initialMasterItemActionState,
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Master Item</DialogTitle>
          <DialogDescription>
            Edit ditolak setelah Master Item dipakai packing session.
          </DialogDescription>
        </DialogHeader>
        <MasterItemForm
          action={formAction}
          error={state.error}
          isPending={isPending}
          masterItem={masterItem}
          submitLabel="Simpan perubahan"
        />
      </DialogContent>
    </Dialog>
  )
}

function MasterItemForm({
  action,
  error,
  isPending,
  masterItem,
  submitLabel,
}: {
  action: (formData: FormData) => void
  error?: string
  isPending: boolean
  masterItem?: MasterItem
  submitLabel: string
}) {
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {masterItem ? (
        <input name="masterItemId" type="hidden" value={masterItem.id} />
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field>
            <FieldLabel
              htmlFor={masterItem ? `itemCode-${masterItem.id}` : "itemCode"}
            >
              Kode item
            </FieldLabel>
            <Input
              defaultValue={masterItem?.item_code}
              id={masterItem ? `itemCode-${masterItem.id}` : "itemCode"}
              maxLength={64}
              name="itemCode"
              placeholder="dm-0001"
              required
            />
          </Field>
          <Field>
            <FieldLabel
              htmlFor={masterItem ? `partNo-${masterItem.id}` : "partNo"}
            >
              Part No
            </FieldLabel>
            <Input
              defaultValue={masterItem?.part_no}
              id={masterItem ? `partNo-${masterItem.id}` : "partNo"}
              maxLength={128}
              name="partNo"
              placeholder="3210A-K1Z-NA01-DL"
              required
            />
          </Field>
        </div>
        <Field>
          <FieldLabel
            htmlFor={masterItem ? `partName-${masterItem.id}` : "partName"}
          >
            Nama part
          </FieldLabel>
          <Input
            defaultValue={masterItem?.part_name}
            id={masterItem ? `partName-${masterItem.id}` : "partName"}
            maxLength={200}
            name="partName"
            placeholder="Tube Assy"
            required
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={masterItem ? `unit-${masterItem.id}` : "unit"}>
              Unit
            </FieldLabel>
            <Input
              defaultValue={masterItem?.unit}
              id={masterItem ? `unit-${masterItem.id}` : "unit"}
              maxLength={32}
              name="unit"
              placeholder="Pcs"
              required
            />
          </Field>
          <Field>
            <FieldLabel
              htmlFor={
                masterItem
                  ? `defaultLabelQty-${masterItem.id}`
                  : "defaultLabelQty"
              }
            >
              Default label Qty
            </FieldLabel>
            <Input
              defaultValue={masterItem?.default_label_qty}
              id={
                masterItem
                  ? `defaultLabelQty-${masterItem.id}`
                  : "defaultLabelQty"
              }
              inputMode="numeric"
              name="defaultLabelQty"
              placeholder="100"
              required
            />
          </Field>
        </div>
        <Field>
          <FieldLabel
            htmlFor={
              masterItem
                ? `itemSequenceCode-${masterItem.id}`
                : "itemSequenceCode"
            }
          >
            Kode sequence opsional
          </FieldLabel>
          <Input
            defaultValue={masterItem?.item_sequence_code ?? ""}
            id={
              masterItem
                ? `itemSequenceCode-${masterItem.id}`
                : "itemSequenceCode"
            }
            maxLength={64}
            name="itemSequenceCode"
            placeholder="LINE-A"
          />
          <FieldDescription>
            Metadata saja. Nomor urut tidak akan dibentuk sebelum scope sequence
            disetujui.
          </FieldDescription>
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

function MasterItemActiveAction({
  isActive,
  masterItemId,
}: {
  isActive: boolean
  masterItemId: string
}) {
  const [state, formAction, isPending] = useActionState(
    setMasterItemActiveAction,
    initialMasterItemActionState,
  )
  useActionStateToast(state)
  const actionLabel = isActive ? "Nonaktifkan" : "Aktifkan"

  return (
    <div className="flex flex-col items-start gap-2">
      <AlertDialog>
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
            <AlertDialogTitle>{actionLabel} Master Item?</AlertDialogTitle>
            <AlertDialogDescription>
              Master Item tidak dihapus. Data historis packing dan print tetap
              dipertahankan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form action={formAction}>
            <input name="masterItemId" type="hidden" value={masterItemId} />
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
