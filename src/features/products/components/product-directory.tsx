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
  createProductAction,
  deleteProductAction,
  setProductActiveAction,
  updateProductAction,
} from "@/features/products/actions"
import { initialProductActionState } from "@/features/products/form-state"
import {
  useActionStateToast,
  useCloseOnActionSuccess,
} from "@/components/shared/action-state-toast"
import { PaginationControls } from "@/components/shared/pagination-controls"
import {
  formatProductPreview,
  normalizeDimensions,
} from "@/features/products/validation"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Product = {
  id: string
  product_code: string
  part_name: string
  outer_diameter: number
  inner_diameter: number
  length: number
  normalized_dimensions: string | null
  is_active: boolean
}

type ProductSortColumn = "part_name" | "normalized_dimensions" | "is_active"
type SortDirection = "asc" | "desc"

const PAGE_SIZE = 20

export function ProductDirectory({ products }: { products: Product[] }) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all")
  const [sortColumn, setSortColumn] = useState<ProductSortColumn>("part_name")
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
  const [page, setPage] = useState(1)

  function toggleSort(column: ProductSortColumn) {
    if (column === sortColumn) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"))
      return
    }
    setSortColumn(column)
    setSortDirection("asc")
    setPage(1)
  }

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("id-ID")

    const filtered = products.filter((product) => {
      const matchesQuery =
        !normalizedQuery ||
        product.product_code
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery) ||
        product.part_name
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery) ||
        product.normalized_dimensions
          ?.toLocaleLowerCase("id-ID")
          .includes(normalizedQuery)
      const matchesStatus =
        status === "all" ||
        (status === "active" ? product.is_active : !product.is_active)

      return matchesQuery && matchesStatus
    })

    const direction = sortDirection === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sortColumn === "is_active") {
        return (Number(a.is_active) - Number(b.is_active)) * direction
      }
      const valueA = (a[sortColumn] ?? "").toString().toLocaleLowerCase("id-ID")
      const valueB = (b[sortColumn] ?? "").toString().toLocaleLowerCase("id-ID")
      return valueA.localeCompare(valueB, "id-ID") * direction
    })
  }, [products, query, status, sortColumn, sortDirection])

  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pagedProducts = filteredProducts.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  const sortLabels: Record<ProductSortColumn, string> = {
    part_name: "Produk",
    normalized_dimensions: "Ukuran normal",
    is_active: "Status",
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1 sm:max-w-sm">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2 left-2.5 size-4" />
            <Input
              aria-label="Cari produk"
              className="pl-8"
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
              placeholder="Cari kode, nama, atau ukuran"
              value={query}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <FilterIcon data-icon="inline-start" />
                Filter
                {status !== "all" ? (
                  <Badge className="ml-1" variant="secondary">
                    1
                  </Badge>
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
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
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Urutkan menurut</DropdownMenuLabel>
              {(Object.keys(sortLabels) as ProductSortColumn[]).map(
                (column) => {
                  const isActive = column === sortColumn
                  const Icon =
                    sortDirection === "asc" ? ArrowUpIcon : ArrowDownIcon
                  return (
                    // Menu tetap terbuka: menekan kolom yang sama membalik arah
                    // urutan, jadi menutupnya memaksa operator membuka lagi.
                    <DropdownMenuItem
                      key={column}
                      onSelect={(event) => {
                        event.preventDefault()
                        toggleSort(column)
                      }}
                    >
                      {sortLabels[column]}
                      {isActive ? <Icon className="ml-auto size-3.5" /> : null}
                    </DropdownMenuItem>
                  )
                },
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CreateProductDialog products={products} />
      </div>

      {filteredProducts.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Tidak ada produk</EmptyTitle>
            <EmptyDescription>
              Ubah pencarian/filter atau buat produk baru.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-xl border">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">No</TableHead>
                <TableHead className="w-[24%]">
                  <SortableHeader
                    column="part_name"
                    label="Produk"
                    onSort={toggleSort}
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                  />
                </TableHead>
                <TableHead className="w-[26%]">
                  <SortableHeader
                    column="normalized_dimensions"
                    label="Ukuran normal"
                    onSort={toggleSort}
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                  />
                </TableHead>
                <TableHead className="w-[14%]">
                  <SortableHeader
                    column="is_active"
                    label="Status"
                    onSort={toggleSort}
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                  />
                </TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedProducts.map((product, index) => (
                <TableRow key={product.id}>
                  <TableCell>
                    {(currentPage - 1) * PAGE_SIZE + index + 1}
                  </TableCell>
                  {/* Kode produk (prd-000001) sengaja tidak ditampilkan: itu
                      nomor internal hasil autogen, dan yang dikenali admin
                      adalah namanya. Kode tetap bisa dicari lewat kotak
                      pencarian di atas. */}
                  <TableCell className="font-medium break-words whitespace-normal">
                    {product.part_name}
                  </TableCell>
                  <TableCell className="font-sans text-xs break-words whitespace-normal">
                    {formatProductPreview(
                      product.part_name,
                      product.outer_diameter,
                      product.inner_diameter,
                      product.length,
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={product.is_active ? "secondary" : "outline"}
                    >
                      {product.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-wrap items-start gap-2">
                      <EditProductDialog
                        product={product}
                        products={products}
                      />
                      <ProductActiveAction
                        isActive={product.is_active}
                        productId={product.id}
                      />
                      <DeleteProductAction
                        productCode={product.product_code}
                        productId={product.id}
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
            totalItems={filteredProducts.length}
          />
        </div>
      )}
    </div>
  )
}

function SortableHeader({
  column,
  label,
  onSort,
  sortColumn,
  sortDirection,
}: {
  column: ProductSortColumn
  label: string
  onSort: (column: ProductSortColumn) => void
  sortColumn: ProductSortColumn
  sortDirection: SortDirection
}) {
  const isActive = column === sortColumn
  const Icon = sortDirection === "asc" ? ArrowUpIcon : ArrowDownIcon

  return (
    <Button
      className="h-auto p-0 font-medium"
      onClick={() => onSort(column)}
      size="sm"
      type="button"
      variant="ghost"
    >
      {label}
      {isActive ? <Icon className="size-3.5" /> : null}
    </Button>
  )
}

function CreateProductDialog({ products }: { products: Product[] }) {
  const [state, formAction, isPending] = useActionState(
    createProductAction,
    initialProductActionState,
  )
  useActionStateToast(state)
  const [open, setOpen] = useState(false)
  useCloseOnActionSuccess(state, () => setOpen(false))

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>
        <Button>
          <PlusIcon data-icon="inline-start" />
          Produk baru
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Buat produk</DialogTitle>
          <DialogDescription>
            Masukkan dimensi OD, ID, dan Length sesuai data master.
          </DialogDescription>
        </DialogHeader>
        <ProductForm
          action={formAction}
          error={state.error}
          isPending={isPending}
          products={products}
          submitLabel="Buat produk"
        />
      </DialogContent>
    </Dialog>
  )
}

function EditProductDialog({
  product,
  products,
}: {
  product: Product
  products: Product[]
}) {
  const [state, formAction, isPending] = useActionState(
    updateProductAction,
    initialProductActionState,
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
          <DialogTitle>Edit produk</DialogTitle>
          <DialogDescription>
            Produk dengan accepted scan tidak dapat diubah agar histori tetap
            konsisten.
          </DialogDescription>
        </DialogHeader>
        <ProductForm
          action={formAction}
          error={state.error}
          isPending={isPending}
          product={product}
          products={products}
          submitLabel="Simpan perubahan"
        />
      </DialogContent>
    </Dialog>
  )
}

function ProductForm({
  action,
  error,
  isPending,
  product,
  products,
  submitLabel,
}: {
  action: (formData: FormData) => void
  error?: string
  isPending: boolean
  product?: Product
  products: Product[]
  submitLabel: string
}) {
  const [productCode, setProductCode] = useState(product?.product_code ?? "")
  const [partName, setPartName] = useState(product?.part_name ?? "")
  const [outerDiameter, setOuterDiameter] = useState(
    product?.outer_diameter.toString() ?? "",
  )
  const [innerDiameter, setInnerDiameter] = useState(
    product?.inner_diameter.toString() ?? "",
  )
  const [length, setLength] = useState(product?.length.toString() ?? "")
  const normalizedDimensions = dimensionPreview(
    outerDiameter,
    innerDiameter,
    length,
  )
  const preview =
    normalizedDimensions && partName.trim()
      ? formatProductPreview(
          partName.trim(),
          Number(outerDiameter),
          Number(innerDiameter),
          Number(length),
        )
      : null
  const duplicateCode = products.find(
    (candidate) =>
      candidate.id !== product?.id &&
      candidate.product_code === productCode.trim().toLowerCase(),
  )
  const normalizedPartName = partName.trim().toLocaleLowerCase("id-ID")
  const duplicateDimensions = normalizedDimensions
    ? products.find(
        (candidate) =>
          candidate.id !== product?.id &&
          candidate.normalized_dimensions === normalizedDimensions &&
          candidate.part_name.trim().toLocaleLowerCase("id-ID") ===
            normalizedPartName,
      )
    : undefined

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {product ? (
        <input name="productId" type="hidden" value={product.id} />
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {duplicateCode || duplicateDimensions ? (
        <Alert
          variant={!product && duplicateDimensions ? "destructive" : "default"}
        >
          <CircleAlertIcon />
          <AlertTitle>
            {!product && duplicateDimensions
              ? "Produk sudah terdaftar"
              : "Potensi konflik data"}
          </AlertTitle>
          <AlertDescription>
            {duplicateCode
              ? `Kode sudah dipakai oleh ${duplicateCode.product_code}.`
              : `Ukuran ${preview} sudah dipakai oleh ${duplicateDimensions?.product_code}.${!product ? " Gunakan produk yang sudah ada." : ""}`}
          </AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup>
        <div className={product ? "grid gap-5 sm:grid-cols-2" : undefined}>
          {product ? (
            <Field>
              <FieldLabel
                htmlFor={product ? `productCode-${product.id}` : "productCode"}
              >
                Kode produk
              </FieldLabel>
              <Input
                id={product ? `productCode-${product.id}` : "productCode"}
                maxLength={64}
                name="productCode"
                onChange={(event) => setProductCode(event.target.value)}
                placeholder="tube-0001"
                required
                value={productCode}
              />
            </Field>
          ) : null}
          <Field>
            <FieldLabel
              htmlFor={product ? `partName-${product.id}` : "partName"}
            >
              Nama part
            </FieldLabel>
            <Input
              value={partName}
              id={product ? `partName-${product.id}` : "partName"}
              maxLength={200}
              name="partName"
              onChange={(event) => setPartName(event.target.value)}
              placeholder="Tube"
              required
            />
          </Field>
        </div>
        {!product ? (
          <FieldDescription>
            Kode produk dibuat otomatis oleh sistem saat data disimpan.
          </FieldDescription>
        ) : null}
        <div className="grid gap-5 sm:grid-cols-3">
          <DimensionField
            id={product ? `outerDiameter-${product.id}` : "outerDiameter"}
            label="OD"
            name="outerDiameter"
            onChange={setOuterDiameter}
            value={outerDiameter}
          />
          <DimensionField
            id={product ? `innerDiameter-${product.id}` : "innerDiameter"}
            label="ID"
            name="innerDiameter"
            onChange={setInnerDiameter}
            value={innerDiameter}
          />
          <DimensionField
            id={product ? `length-${product.id}` : "length"}
            label="Length"
            name="length"
            onChange={setLength}
            value={length}
          />
        </div>
        <Field>
          <FieldLabel>Preview ukuran normal</FieldLabel>
          <div className="bg-muted rounded-lg px-2.5 py-2 font-sans text-sm">
            {preview ?? "Masukkan OD, ID, dan Length positif"}
          </div>
          <FieldDescription>
            Key ini tidak unik global; sistem hanya memberi peringatan konflik.
          </FieldDescription>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button
          disabled={
            isPending ||
            Boolean(duplicateCode) ||
            (!product && Boolean(duplicateDimensions))
          }
          type="submit"
        >
          {isPending ? <Spinner data-icon="inline-start" /> : null}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

function DimensionField({
  id,
  label,
  name,
  onChange,
  value,
}: {
  id: string
  label: string
  name: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        inputMode="decimal"
        name={name}
        onChange={(event) => onChange(event.target.value)}
        placeholder="0"
        required
        value={value}
      />
    </Field>
  )
}

function ProductActiveAction({
  isActive,
  productId,
}: {
  isActive: boolean
  productId: string
}) {
  const [state, formAction, isPending] = useActionState(
    setProductActiveAction,
    initialProductActionState,
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
            <AlertDialogTitle>{actionLabel} produk?</AlertDialogTitle>
            <AlertDialogDescription>
              Produk tidak dihapus. Riwayat master dan scan tetap disimpan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form action={formAction}>
            <input name="productId" type="hidden" value={productId} />
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

function DeleteProductAction({
  productCode,
  productId,
}: {
  productCode: string
  productId: string
}) {
  const [state, formAction, isPending] = useActionState(
    deleteProductAction,
    initialProductActionState,
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
            <AlertDialogTitle>Hapus produk {productCode}?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini permanen. Produk yang masih dipakai Master Item, Box
              Definition, atau riwayat scan tidak dapat dihapus.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form action={formAction}>
            <input name="productId" type="hidden" value={productId} />
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

function dimensionPreview(
  outerDiameter: string,
  innerDiameter: string,
  length: string,
): string | null {
  const values = [outerDiameter, innerDiameter, length].map(Number)
  return values.every((value) => Number.isFinite(value) && value > 0)
    ? normalizeDimensions(values[0], values[1], values[2])
    : null
}
