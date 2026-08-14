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
  createProductAction,
  deleteProductAction,
  setProductActiveAction,
  updateProductAction,
} from "@/features/products/actions"
import { initialProductActionState } from "@/features/products/form-state"
import {
  DEFAULT_PRODUCT_SORT,
  PRODUCT_SORT_OPTIONS,
  headerSortDirection,
  nextHeaderSort,
  sortProducts,
  type ProductSortHeader,
  type ProductSortKey,
} from "@/features/products/sorting"
import {
  useActionStateToast,
  useCloseOnActionSuccess,
} from "@/components/shared/action-state-toast"
import { PaginationControls } from "@/components/shared/pagination-controls"
import {
  PRODUCT_NAME_PREFIXES,
  formatProductPreview,
  normalizeDimensions,
  parseProductName,
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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
  part_type: string | null
  outer_diameter: number
  inner_diameter: number
  length: number
  normalized_dimensions: string | null
  is_active: boolean
  created_at: string
}

const PAGE_SIZE = 20

export function ProductDirectory({ products }: { products: Product[] }) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all")
  const [sortKey, setSortKey] = useState<ProductSortKey>(DEFAULT_PRODUCT_SORT)
  const [page, setPage] = useState(1)

  function applySort(key: ProductSortKey) {
    setSortKey(key)
    setPage(1)
  }

  function toggleHeaderSort(header: ProductSortHeader) {
    applySort(nextHeaderSort(header, sortKey))
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

    return sortProducts(filtered, sortKey)
  }, [products, query, status, sortKey])

  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pagedProducts = filteredProducts.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  const activeSort = PRODUCT_SORT_OPTIONS.find(
    (option) => option.key === sortKey,
  )

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
                {/* Urutan yang sedang berlaku ditulis di tombolnya. Sebelumnya
                    ia hanya terbaca dari panah kecil di dalam menu, jadi admin
                    harus membuka menunya dulu untuk tahu daftar ini sedang
                    diurutkan menurut apa. */}
                {activeSort && activeSort.key !== DEFAULT_PRODUCT_SORT ? (
                  <Badge className="ml-1" variant="secondary">
                    {activeSort.label}
                  </Badge>
                ) : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Urutkan menurut</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                onValueChange={(value) => applySort(value as ProductSortKey)}
                value={sortKey}
              >
                {PRODUCT_SORT_OPTIONS.map((option, index) => {
                  const startsGroup =
                    index > 0 &&
                    PRODUCT_SORT_OPTIONS[index - 1].group !== option.group
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
                    header="nama"
                    label="Produk"
                    onSort={toggleHeaderSort}
                    sortKey={sortKey}
                  />
                </TableHead>
                <TableHead className="w-[26%]">
                  <SortableHeader
                    header="ukuran"
                    label="Ukuran normal"
                    onSort={toggleHeaderSort}
                    sortKey={sortKey}
                  />
                </TableHead>
                <TableHead className="w-[14%]">
                  <SortableHeader
                    header="status"
                    label="Status"
                    onSort={toggleHeaderSort}
                    sortKey={sortKey}
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
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium break-words">
                        {product.part_name}
                      </span>
                      {/* Produk lama belum punya jenis part: dibiarkan kosong
                          daripada diisi tebakan, dan terisi sendiri begitu
                          produknya disunting. */}
                      <span className="text-muted-foreground text-xs break-words">
                        {product.part_type ?? "Part belum diisi"}
                      </span>
                    </div>
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
  header,
  label,
  onSort,
  sortKey,
}: {
  header: ProductSortHeader
  label: string
  onSort: (header: ProductSortHeader) => void
  sortKey: ProductSortKey
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
  const [partType, setPartType] = useState(product?.part_type ?? "")
  const [productName, setProductName] = useState(
    product
      ? formatProductPreview(
          product.part_name,
          product.outer_diameter,
          product.inner_diameter,
          product.length,
        )
      : "",
  )

  // Nama diurai saat diketik, jadi operator melihat bentuk bakunya — atau
  // sebab penolakannya — sebelum menekan Simpan, bukan sesudahnya.
  const parsedName = parseProductName(productName)
  const parsed = "error" in parsedName ? null : parsedName.data
  const preview = parsed
    ? formatProductPreview(
        parsed.partName,
        parsed.outerDiameter,
        parsed.innerDiameter,
        parsed.length,
      )
    : null
  const nameError =
    productName.trim() && "error" in parsedName ? parsedName.error : null
  const normalizedDimensions = parsed
    ? normalizeDimensions(
        parsed.outerDiameter,
        parsed.innerDiameter,
        parsed.length,
      )
    : null
  const duplicateDimensions =
    normalizedDimensions && parsed
      ? products.find(
          (candidate) =>
            candidate.id !== product?.id &&
            candidate.normalized_dimensions === normalizedDimensions &&
            candidate.part_name.trim().toLocaleLowerCase("id-ID") ===
              parsed.partName.toLocaleLowerCase("id-ID"),
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
      {duplicateDimensions ? (
        <Alert variant={product ? "default" : "destructive"}>
          <CircleAlertIcon />
          <AlertTitle>
            {product ? "Potensi konflik data" : "Produk sudah terdaftar"}
          </AlertTitle>
          <AlertDescription>
            {`${preview} sudah terdaftar.${product ? "" : " Gunakan produk yang sudah ada."}`}
          </AlertDescription>
        </Alert>
      ) : null}
      {/* Kode produk tidak lagi punya field: ia dibuat otomatis, dan saat
          menyunting nilainya dibawa apa adanya supaya tidak berubah. */}
      {product ? (
        <input name="productCode" type="hidden" value={product.product_code} />
      ) : null}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={product ? `partType-${product.id}` : "partType"}>
            Part
          </FieldLabel>
          <Input
            id={product ? `partType-${product.id}` : "partType"}
            maxLength={100}
            name="partType"
            onChange={(event) => setPartType(event.target.value)}
            placeholder="Tube Assy"
            required
            value={partType}
          />
          <FieldDescription>
            Huruf depan tiap kata disimpan kapital: &quot;tube assy&quot;
            tersimpan sebagai &quot;Tube Assy&quot;.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel
            htmlFor={product ? `productName-${product.id}` : "productName"}
          >
            Nama
          </FieldLabel>
          <Input
            id={product ? `productName-${product.id}` : "productName"}
            maxLength={200}
            name="productName"
            onChange={(event) => setProductName(event.target.value)}
            placeholder="vo b 6x7x525"
            required
            value={productName}
          />
          <FieldDescription>
            Boleh diketik bebas; yang tersimpan bentuk bakunya. Awalan yang
            tersedia: {PRODUCT_NAME_PREFIXES.join(", ")}.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Hasil</FieldLabel>
          <div className="bg-muted rounded-lg px-2.5 py-2 font-sans text-sm">
            {preview ?? nameError ?? "Contoh: vo b 6x7x525"}
          </div>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button
          disabled={
            isPending ||
            !parsed ||
            !partType.trim() ||
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
