"use client"

import { Fragment, useActionState, useMemo, useState } from "react"
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
  createMpqRowAction,
  deleteMpqRowAction,
  setMpqRowActiveAction,
  updateMpqRowAction,
} from "@/features/mpq-sheet/actions"
import { initialMpqActionState } from "@/features/mpq-sheet/form-state"
import {
  DEFAULT_MPQ_SORT,
  MPQ_SORT_OPTIONS,
  headerSortDirection,
  nextHeaderSort,
  sortMpqRows,
  type MpqSortHeader,
  type MpqSortKey,
} from "@/features/mpq-sheet/sorting"
import {
  useActionStateToast,
  useCloseOnActionSuccess,
} from "@/components/shared/action-state-toast"
import { PaginationControls } from "@/components/shared/pagination-controls"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type MpqSheetRow = {
  id: string
  is_active: boolean
  mpq_qty: number
  product_size: string
  row_no: number
  unit: string
}

const PAGE_SIZE = 20

/**
 * Spasi dibuang dari kedua sisi sebelum dibandingkan. Dokumen MPQ menulis
 * "L=60 MM" sementara label menulis "L=60MM", dan admin mengetik salah satunya
 * tanpa tahu daftar ini memakai yang mana — sama seperti pencocokan di
 * verify_delivery_label.
 */
function searchKey(value: string): string {
  return value.replace(/\s/g, "").toLocaleLowerCase("id-ID")
}

export function MpqSheetDirectory({ rows }: { rows: MpqSheetRow[] }) {
  const [query, setQuery] = useState("")
  const [unit, setUnit] = useState("all")
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all")
  const [sortKey, setSortKey] = useState<MpqSortKey>(DEFAULT_MPQ_SORT)
  const [page, setPage] = useState(1)

  // Satuan diambil dari datanya, bukan ditulis tetap di sini: satuan baru yang
  // ditambahkan admin muncul sendiri di filternya.
  const units = useMemo(
    () => [...new Set(rows.map((row) => row.unit))].sort(),
    [rows],
  )

  function applySort(key: MpqSortKey) {
    setSortKey(key)
    setPage(1)
  }

  function toggleHeaderSort(header: MpqSortHeader) {
    applySort(nextHeaderSort(header, sortKey))
  }

  const filteredRows = useMemo(() => {
    const normalizedQuery = searchKey(query.trim())

    const filtered = rows.filter((row) => {
      const matchesQuery =
        !normalizedQuery ||
        searchKey(row.product_size).includes(normalizedQuery) ||
        String(row.mpq_qty).includes(normalizedQuery)
      const matchesUnit = unit === "all" || row.unit === unit
      const matchesStatus =
        status === "all" ||
        (status === "active" ? row.is_active : !row.is_active)

      return matchesQuery && matchesUnit && matchesStatus
    })

    return sortMpqRows(filtered, sortKey)
  }, [rows, query, unit, status, sortKey])

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pagedRows = filteredRows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  const activeSort = MPQ_SORT_OPTIONS.find((option) => option.key === sortKey)
  const activeFilters = (unit === "all" ? 0 : 1) + (status === "all" ? 0 : 1)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1 sm:max-w-sm">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2 left-2.5 size-4" />
            <Input
              aria-label="Cari ukuran"
              className="pl-8"
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
              placeholder="Cari ukuran atau Qty MPQ"
              value={query}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <FilterIcon data-icon="inline-start" />
                Filter
                {activeFilters > 0 ? (
                  <Badge className="ml-1" variant="secondary">
                    {activeFilters}
                  </Badge>
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Unit/Box</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                onValueChange={(value) => {
                  setUnit(value)
                  setPage(1)
                }}
                value={unit}
              >
                <DropdownMenuRadioItem value="all">
                  Semua satuan
                </DropdownMenuRadioItem>
                {units.map((option) => (
                  <DropdownMenuRadioItem key={option} value={option}>
                    {option}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Status</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                onValueChange={(value) => {
                  setStatus(value as typeof status)
                  setPage(1)
                }}
                value={status}
              >
                <DropdownMenuRadioItem value="all">
                  Semua status
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="active">
                  Aktif
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="inactive">
                  Nonaktif
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <ArrowUpDownIcon data-icon="inline-start" />
                Urutkan
                {activeSort && activeSort.key !== DEFAULT_MPQ_SORT ? (
                  <Badge className="ml-1" variant="secondary">
                    {activeSort.label}
                  </Badge>
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Urutkan menurut</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                onValueChange={(value) => applySort(value as MpqSortKey)}
                value={sortKey}
              >
                {MPQ_SORT_OPTIONS.map((option, index) => {
                  const startsGroup =
                    index > 0 &&
                    MPQ_SORT_OPTIONS[index - 1].group !== option.group
                  const Icon =
                    option.direction === "asc" ? ArrowUpIcon : ArrowDownIcon

                  return (
                    <Fragment key={option.key}>
                      {startsGroup ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuRadioItem value={option.key}>
                        {option.label}
                        <Icon className="text-muted-foreground ml-auto size-3.5" />
                      </DropdownMenuRadioItem>
                    </Fragment>
                  )
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CreateMpqRowDialog />
      </div>

      {filteredRows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Tidak ada ukuran</EmptyTitle>
            <EmptyDescription>
              Ubah pencarian/filter atau tambah ukuran baru.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-xl border">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">No</TableHead>
                <TableHead>
                  <SortableHeader
                    header="ukuran"
                    label="Ukuran"
                    onSort={toggleHeaderSort}
                    sortKey={sortKey}
                  />
                </TableHead>
                <TableHead className="w-[13%]">
                  <SortableHeader
                    header="mpq"
                    label="Qty MPQ"
                    onSort={toggleHeaderSort}
                    sortKey={sortKey}
                  />
                </TableHead>
                <TableHead className="w-[15%]">
                  <SortableHeader
                    header="satuan"
                    label="Unit/Box"
                    onSort={toggleHeaderSort}
                    sortKey={sortKey}
                  />
                </TableHead>
                <TableHead className="w-[12%]">
                  <SortableHeader
                    header="status"
                    label="Status"
                    onSort={toggleHeaderSort}
                    sortKey={sortKey}
                  />
                </TableHead>
                <TableHead className="w-[24%]">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.map((row, index) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {(currentPage - 1) * PAGE_SIZE + index + 1}
                  </TableCell>
                  <TableCell className="font-medium break-words whitespace-normal">
                    {row.product_size}
                  </TableCell>
                  {/* MPQ naik sampai lima digit; tanpa pemisah ribuan angka
                      sebesar itu harus dihitung digitnya dulu sebelum
                      terbaca. */}
                  <TableCell className="tabular-nums">
                    {row.mpq_qty.toLocaleString("id-ID")}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {row.unit}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.is_active ? "secondary" : "outline"}>
                      {row.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-wrap items-start gap-2">
                      <EditMpqRowDialog row={row} />
                      <MpqRowActiveAction
                        isActive={row.is_active}
                        productSize={row.product_size}
                        rowId={row.id}
                      />
                      <DeleteMpqRowAction
                        productSize={row.product_size}
                        rowId={row.id}
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
            totalItems={filteredRows.length}
          />
        </div>
      )}
    </div>
  )
}

function SortableHeader({
  header,
  label,
  onSort,
  sortKey,
}: {
  header: MpqSortHeader
  label: string
  onSort: (header: MpqSortHeader) => void
  sortKey: MpqSortKey
}) {
  const direction = headerSortDirection(header, sortKey)
  const Icon = direction === "desc" ? ArrowDownIcon : ArrowUpIcon

  return (
    <Button
      className="h-auto p-0 font-medium"
      onClick={() => onSort(header)}
      size="sm"
      type="button"
      variant="ghost"
    >
      {label}
      {direction ? <Icon className="size-3.5" /> : null}
    </Button>
  )
}

function CreateMpqRowDialog() {
  const [state, formAction, isPending] = useActionState(
    createMpqRowAction,
    initialMpqActionState,
  )
  useActionStateToast(state)
  const [open, setOpen] = useState(false)
  useCloseOnActionSuccess(state, () => setOpen(false))

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon data-icon="inline-start" />
          Tambah ukuran
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tambah ukuran</DialogTitle>
          <DialogDescription>
            MPQ menentukan berapa box yang harus discan saat Verifikasi
            Pengiriman.
          </DialogDescription>
        </DialogHeader>
        <MpqRowForm
          action={formAction}
          error={state.error}
          isPending={isPending}
          submitLabel="Tambah ukuran"
        />
      </DialogContent>
    </Dialog>
  )
}

function EditMpqRowDialog({ row }: { row: MpqSheetRow }) {
  const [state, formAction, isPending] = useActionState(
    updateMpqRowAction,
    initialMpqActionState,
  )
  useActionStateToast(state)
  const [open, setOpen] = useState(false)
  useCloseOnActionSuccess(state, () => setOpen(false))

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <PencilIcon data-icon="inline-start" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit ukuran</DialogTitle>
          {/* Jadwal menyalin MPQ ke barisnya sendiri saat diunggah, jadi truk
              yang sedang diperiksa tidak berubah jumlah box-nya di tengah
              jalan. Itu perlu dikatakan: tanpa ini admin akan ragu menyunting
              MPQ selagi ada session berjalan. */}
          <DialogDescription>
            Perubahan berlaku untuk jadwal yang diunggah setelah ini. Jadwal
            yang sedang berjalan memakai MPQ yang tersalin saat diunggah.
          </DialogDescription>
        </DialogHeader>
        <MpqRowForm
          action={formAction}
          error={state.error}
          isPending={isPending}
          row={row}
          submitLabel="Simpan perubahan"
        />
      </DialogContent>
    </Dialog>
  )
}

function MpqRowForm({
  action,
  error,
  isPending,
  row,
  submitLabel,
}: {
  action: (formData: FormData) => void
  error?: string
  isPending: boolean
  row?: MpqSheetRow
  submitLabel: string
}) {
  const [productSize, setProductSize] = useState(row?.product_size ?? "")
  const [mpqQty, setMpqQty] = useState(row ? String(row.mpq_qty) : "")
  const [unit, setUnit] = useState(row?.unit ?? "PCS/BOX")

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {row ? <input name="rowId" type="hidden" value={row.id} /> : null}
      {error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={row ? `productSize-${row.id}` : "productSize"}>
            Ukuran
          </FieldLabel>
          <Input
            id={row ? `productSize-${row.id}` : "productSize"}
            maxLength={100}
            name="productSize"
            onChange={(event) => setProductSize(event.target.value)}
            placeholder="VS-B T0.3XW100 L=195MM"
            required
            value={productSize}
          />
          <FieldDescription>
            Tersimpan huruf besar. Spasi tidak membedakan: &quot;L=60 MM&quot;
            dan &quot;L=60MM&quot; dihitung satu ukuran.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={row ? `mpqQty-${row.id}` : "mpqQty"}>
            Qty MPQ
          </FieldLabel>
          <Input
            id={row ? `mpqQty-${row.id}` : "mpqQty"}
            inputMode="numeric"
            name="mpqQty"
            onChange={(event) => setMpqQty(event.target.value)}
            placeholder="2000"
            required
            value={mpqQty}
          />
          <FieldDescription>
            Jumlah sheet maksimum dalam satu box.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={row ? `unit-${row.id}` : "unit"}>
            Unit/Box
          </FieldLabel>
          <Input
            id={row ? `unit-${row.id}` : "unit"}
            maxLength={32}
            name="unit"
            onChange={(event) => setUnit(event.target.value)}
            placeholder="PCS/BOX"
            required
            value={unit}
          />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button
          disabled={isPending || !productSize.trim() || !mpqQty.trim()}
          type="submit"
        >
          {isPending ? <Spinner data-icon="inline-start" /> : null}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

function MpqRowActiveAction({
  isActive,
  productSize,
  rowId,
}: {
  isActive: boolean
  productSize: string
  rowId: string
}) {
  const [state, formAction, isPending] = useActionState(
    setMpqRowActiveAction,
    initialMpqActionState,
  )
  useActionStateToast(state)
  const [open, setOpen] = useState(false)
  useCloseOnActionSuccess(state, () => setOpen(false))
  const actionLabel = isActive ? "Nonaktifkan" : "Aktifkan"

  return (
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
          <AlertDialogTitle>
            {actionLabel} {productSize}?
          </AlertDialogTitle>
          {/* Akibatnya disebutkan, bukan "tindakan ini dapat dibatalkan":
              ukuran nonaktif diperlakukan jadwal baru seperti belum punya MPQ
              sama sekali, dan barisnya tidak akan bisa discan. */}
          <AlertDialogDescription>
            {isActive
              ? "Jadwal yang diunggah setelah ini akan memperlakukan ukuran tersebut seperti belum ada MPQ-nya, jadi barisnya tidak bisa discan. Jadwal yang sedang berjalan tidak berubah."
              : "Ukuran ini dipakai lagi untuk jadwal yang diunggah setelah ini."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form action={formAction}>
          <input name="rowId" type="hidden" value={rowId} />
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
  )
}

function DeleteMpqRowAction({
  productSize,
  rowId,
}: {
  productSize: string
  rowId: string
}) {
  const [state, formAction, isPending] = useActionState(
    deleteMpqRowAction,
    initialMpqActionState,
  )
  useActionStateToast(state)
  const [open, setOpen] = useState(false)
  useCloseOnActionSuccess(state, () => setOpen(false))

  return (
    <AlertDialog onOpenChange={setOpen} open={open}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="destructive">
          <Trash2Icon data-icon="inline-start" />
          Hapus
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus {productSize}?</AlertDialogTitle>
          <AlertDialogDescription>
            Tindakan ini permanen. Jadwal yang sedang berjalan tidak terganggu —
            ia menyalin MPQ saat diunggah — tetapi jadwal berikutnya akan
            menandai ukuran ini &quot;MPQ belum ada&quot;. Kalau hanya ingin
            berhenti memakainya, pilih Nonaktifkan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form action={formAction}>
          <input name="rowId" type="hidden" value={rowId} />
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
  )
}
