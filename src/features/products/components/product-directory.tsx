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
  createProductAction,
  setProductActiveAction,
  updateProductAction,
} from "@/features/products/actions"
import { initialProductActionState } from "@/features/products/form-state"
import { useActionStateToast } from "@/components/shared/action-state-toast"
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

export function ProductDirectory({ products }: { products: Product[] }) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all")
  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("id-ID")

    return products.filter((product) => {
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
  }, [products, query, status])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-3 sm:grid-cols-[minmax(16rem,24rem)_10rem]">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2 left-2.5 size-4" />
            <Input
              aria-label="Cari produk"
              className="pl-8"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari kode, nama, atau ukuran"
              value={query}
            />
          </div>
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as typeof status)}
          >
            <SelectTrigger aria-label="Filter status produk" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              <SelectItem value="active">Aktif</SelectItem>
              <SelectItem value="inactive">Nonaktif</SelectItem>
            </SelectContent>
          </Select>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead>Ukuran normal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredProducts.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        {product.product_code}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {product.part_name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="font-sans text-xs">
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
                  <TableCell>
                    <div className="flex items-start gap-2">
                      <EditProductDialog
                        product={product}
                        products={products}
                      />
                      <ProductActiveAction
                        isActive={product.is_active}
                        productId={product.id}
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

function CreateProductDialog({ products }: { products: Product[] }) {
  const [state, formAction, isPending] = useActionState(
    createProductAction,
    initialProductActionState,
  )
  useActionStateToast(state)

  return (
    <Dialog>
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
  const duplicateDimensions = normalizedDimensions
    ? products.find(
        (candidate) =>
          candidate.id !== product?.id &&
          candidate.normalized_dimensions === normalizedDimensions,
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
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>Potensi konflik data</AlertTitle>
          <AlertDescription>
            {duplicateCode
              ? `Kode sudah dipakai oleh ${duplicateCode.product_code}.`
              : `Ukuran ${preview} sudah dipakai oleh ${duplicateDimensions?.product_code}.`}
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
        <Button disabled={isPending} type="submit">
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
