"use client"

import { useActionState, useMemo, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  BanIcon,
  CheckIcon,
  CircleAlertIcon,
  FilterIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"

import {
  createMasterItemAction,
  deleteMasterItemAction,
  setMasterItemActiveAction,
  updateMasterItemAction,
} from "@/features/master-items/actions"
import {
  initialLayerProductSelections,
  layerProductSelectionsToPayload,
  MasterItemBoxLayerFields,
  type LayerProductSelections,
  type MasterItemBox,
  type ProductOption,
} from "@/features/master-items/components/master-item-box-layer-editor"
import { initialMasterItemActionState } from "@/features/master-items/form-state"
import {
  useActionStateToast,
  useCloseOnActionSuccess,
} from "@/components/shared/action-state-toast"
import { PaginationControls } from "@/components/shared/pagination-controls"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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

export type MasterItem = {
  id: string
  item_code: string
  part_no: string
  part_name: string
  unit: string
  default_label_qty: number
  supplier_id: string | null
  is_active: boolean
}

export type SupplierOption = {
  id: string
  supplier_code: string
  supplier_name: string
}

type SortColumn = "part_no" | "is_active"
type SortDirection = "asc" | "desc"

const PAGE_SIZE = 20

export function MasterItemDirectory({
  boxes,
  masterItems,
  products,
  suppliers,
}: {
  boxes: MasterItemBox[]
  masterItems: MasterItem[]
  products: ProductOption[]
  suppliers: SupplierOption[]
}) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all")
  const [sortColumn, setSortColumn] = useState<SortColumn>("part_no")
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
  const [page, setPage] = useState(1)

  function toggleSort(column: SortColumn) {
    if (column === sortColumn) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"))
      return
    }
    setSortColumn(column)
    setSortDirection("asc")
    setPage(1)
  }

  const filteredMasterItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("id-ID")

    const filtered = masterItems.filter((masterItem) => {
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

    const direction = sortDirection === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sortColumn === "is_active") {
        return (Number(a.is_active) - Number(b.is_active)) * direction
      }
      return (
        a[sortColumn]
          .toLocaleLowerCase("id-ID")
          .localeCompare(b[sortColumn].toLocaleLowerCase("id-ID"), "id-ID") *
        direction
      )
    })
  }, [masterItems, query, status, sortColumn, sortDirection])

  const pageCount = Math.max(1, Math.ceil(filteredMasterItems.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pagedMasterItems = filteredMasterItems.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  const sortLabels: Record<SortColumn, string> = {
    part_no: "Part No",
    is_active: "Status",
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1 sm:max-w-sm">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2 left-2.5 size-4" />
            <Input
              aria-label="Cari Master Item"
              className="pl-8"
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
              placeholder="Cari kode, Part No, atau nama"
              value={query}
            />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <FilterIcon data-icon="inline-start" />
                Filter
                {status !== "all" ? (
                  <Badge className="ml-1" variant="secondary">
                    1
                  </Badge>
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64">
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground text-xs font-medium">
                  Status
                </p>
                <Select
                  value={status}
                  onValueChange={(value) => {
                    setStatus(value as typeof status)
                    setPage(1)
                  }}
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
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <ArrowUpDownIcon data-icon="inline-start" />
                Urutkan
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56">
              <div className="flex flex-col gap-1">
                {(Object.keys(sortLabels) as SortColumn[]).map((column) => {
                  const isActive = column === sortColumn
                  const Icon =
                    sortDirection === "asc" ? ArrowUpIcon : ArrowDownIcon
                  return (
                    <Button
                      className="justify-between"
                      key={column}
                      onClick={() => toggleSort(column)}
                      type="button"
                      variant={isActive ? "secondary" : "ghost"}
                    >
                      {sortLabels[column]}
                      {isActive ? <Icon className="size-3.5" /> : null}
                    </Button>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <CreateMasterItemDialog suppliers={suppliers} />
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
                <TableHead>Status</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedMasterItems.map((masterItem, index) => (
                <TableRow key={masterItem.id}>
                  <TableCell>{(currentPage - 1) * PAGE_SIZE + index + 1}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{masterItem.part_no}</span>
                      <span className="text-muted-foreground text-xs">
                        {masterItem.part_name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {masterItem.unit} · Qty {masterItem.default_label_qty}
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
                      <EditMasterItemDialog
                        boxes={boxes}
                        masterItem={masterItem}
                        products={products}
                        suppliers={suppliers}
                      />
                      <MasterItemActiveAction
                        isActive={masterItem.is_active}
                        masterItemId={masterItem.id}
                      />
                      <DeleteMasterItemAction
                        masterItemId={masterItem.id}
                        partNo={masterItem.part_no}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationControls
            currentPage={currentPage}
            onPageChange={setPage}
            pageCount={pageCount}
            totalItems={filteredMasterItems.length}
          />
        </div>
      )}
    </div>
  )
}

function CreateMasterItemDialog({ suppliers }: { suppliers: SupplierOption[] }) {
  const [state, formAction, isPending] = useActionState(
    createMasterItemAction,
    initialMasterItemActionState,
  )
  useActionStateToast(state)
  const [open, setOpen] = useState(false)
  useCloseOnActionSuccess(state, () => setOpen(false))

  return (
    <Dialog onOpenChange={setOpen} open={open}>
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
          suppliers={suppliers}
        />
      </DialogContent>
    </Dialog>
  )
}

function EditMasterItemDialog({
  boxes,
  masterItem,
  products,
  suppliers,
}: {
  boxes: MasterItemBox[]
  masterItem: MasterItem
  products: ProductOption[]
  suppliers: SupplierOption[]
}) {
  const [state, formAction, isPending] = useActionState(
    updateMasterItemAction,
    initialMasterItemActionState,
  )
  useActionStateToast(state)
  const [open, setOpen] = useState(false)
  useCloseOnActionSuccess(state, () => setOpen(false))

  const [selections, setSelections] = useState<LayerProductSelections>(() =>
    initialLayerProductSelections(boxes, masterItem.id),
  )

  function toggleProduct(boxLayerId: string, productId: string) {
    setSelections((previous) => {
      const current = previous[boxLayerId] ?? []
      const next = current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
      return { ...previous, [boxLayerId]: next }
    })
  }

  const formId = `master-item-edit-form-${masterItem.id}`

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <PencilIcon data-icon="inline-start" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit Master Item</DialogTitle>
          <DialogDescription>
            Edit ditolak setelah Master Item dipakai packing session.
          </DialogDescription>
        </DialogHeader>
        <MasterItemForm
          action={formAction}
          error={state.error}
          formId={formId}
          layerRequirementsJson={layerProductSelectionsToPayload(selections)}
          masterItem={masterItem}
          showFooter={false}
          suppliers={suppliers}
        />
        <div className="border-t pt-5">
          <MasterItemBoxLayerFields
            boxes={boxes}
            masterItem={masterItem}
            onToggleProduct={toggleProduct}
            products={products}
            selections={selections}
          />
        </div>
        <DialogFooter>
          <Button disabled={isPending} form={formId} type="submit">
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            Simpan perubahan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MasterItemForm({
  action,
  error,
  formId,
  isPending,
  layerRequirementsJson,
  masterItem,
  showFooter = true,
  submitLabel,
  suppliers,
}: {
  action: (formData: FormData) => void
  error?: string
  formId?: string
  isPending?: boolean
  layerRequirementsJson?: string
  masterItem?: MasterItem
  showFooter?: boolean
  submitLabel?: string
  suppliers: SupplierOption[]
}) {
  return (
    <form
      action={action}
      className="flex flex-col gap-5"
      id={formId}
      noValidate
    >
      {masterItem ? (
        <input name="masterItemId" type="hidden" value={masterItem.id} />
      ) : null}
      {layerRequirementsJson !== undefined ? (
        <input
          name="layerRequirements"
          type="hidden"
          value={layerRequirementsJson}
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
        <Field>
          <FieldLabel
            htmlFor={masterItem ? `supplierId-${masterItem.id}` : "supplierId"}
          >
            Supplier
          </FieldLabel>
          <Select
            defaultValue={masterItem?.supplier_id ?? "none"}
            name="supplierId"
          >
            <SelectTrigger
              className="w-full"
              id={masterItem ? `supplierId-${masterItem.id}` : "supplierId"}
            >
              <SelectValue placeholder="Tanpa supplier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Tanpa supplier</SelectItem>
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
              Packing Qty
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
      </FieldGroup>
      {showFooter ? (
        <DialogFooter>
          <Button disabled={isPending} type="submit">
            {isPending ? <Spinner data-icon="inline-start" /> : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      ) : null}
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

function DeleteMasterItemAction({
  masterItemId,
  partNo,
}: {
  masterItemId: string
  partNo: string
}) {
  const [state, formAction, isPending] = useActionState(
    deleteMasterItemAction,
    initialMasterItemActionState,
  )
  useActionStateToast(state)
  const [open, setOpen] = useState(false)
  useCloseOnActionSuccess(state, () => setOpen(false))

  return (
    <div className="flex flex-col items-start gap-2">
      <AlertDialog onOpenChange={setOpen} open={open}>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive">
            <Trash2Icon data-icon="inline-start" />
            Hapus
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Master Item {partNo}?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini permanen. Master Item yang masih dipakai Box,
              Product Mapping, atau riwayat packing tidak dapat dihapus.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form action={formAction}>
            <input name="masterItemId" type="hidden" value={masterItemId} />
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
      {state.error ? (
        <Alert className="max-w-xs" variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
