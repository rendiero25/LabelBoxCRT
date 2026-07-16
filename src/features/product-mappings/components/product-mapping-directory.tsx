"use client"

import { useActionState, useMemo, useState } from "react"
import {
  BanIcon,
  CheckIcon,
  CircleAlertIcon,
  Link2Icon,
  SearchIcon,
} from "lucide-react"

import {
  createProductMappingAction,
  setProductMappingActiveAction,
} from "@/features/product-mappings/actions"
import { initialProductMappingActionState } from "@/features/product-mappings/form-state"
import { useActionStateToast } from "@/components/shared/action-state-toast"
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

export type ProductMappingMasterItem = {
  id: string
  item_code: string
  part_no: string
  part_name: string
  is_active: boolean
}

export type ProductMappingProduct = {
  id: string
  product_code: string
  part_name: string
  normalized_dimensions: string | null
  is_active: boolean
}

export type ProductMapping = {
  id: string
  is_active: boolean
  masterItem: ProductMappingMasterItem
  product: ProductMappingProduct
}

export function ProductMappingDirectory({
  masterItems,
  mappings,
  products,
}: {
  masterItems: ProductMappingMasterItem[]
  mappings: ProductMapping[]
  products: ProductMappingProduct[]
}) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all")
  const filteredMappings = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("id-ID")

    return mappings.filter((mapping) => {
      const matchesQuery =
        !normalizedQuery ||
        mapping.masterItem.item_code
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery) ||
        mapping.masterItem.part_no
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery) ||
        mapping.masterItem.part_name
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery) ||
        mapping.product.product_code
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery) ||
        mapping.product.part_name
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery) ||
        mapping.product.normalized_dimensions
          ?.toLocaleLowerCase("id-ID")
          .includes(normalizedQuery)
      const matchesStatus =
        status === "all" ||
        (status === "active" ? mapping.is_active : !mapping.is_active)

      return matchesQuery && matchesStatus
    })
  }, [mappings, query, status])

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-3 sm:grid-cols-[minmax(16rem,24rem)_10rem]">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2 left-2.5 size-4" />
            <Input
              aria-label="Cari Product Mapping"
              className="pl-8"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari produk, Part No, atau nama"
              value={query}
            />
          </div>
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as typeof status)}
          >
            <SelectTrigger
              aria-label="Filter status Product Mapping"
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
        <CreateProductMappingDialog
          masterItems={masterItems}
          mappings={mappings}
          products={products}
        />
      </div>

      {filteredMappings.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Tidak ada Product Mapping</EmptyTitle>
            <EmptyDescription>
              Ubah pencarian/filter atau hubungkan produk ke Master Item.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Master Item</TableHead>
                <TableHead>Produk</TableHead>
                <TableHead>Ukuran normal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMappings.map((mapping) => (
                <TableRow key={mapping.id}>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        {mapping.masterItem.part_no}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {mapping.masterItem.item_code} -{" "}
                        {mapping.masterItem.part_name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        {mapping.product.product_code}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {mapping.product.part_name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="font-sans text-xs">
                    {mapping.product.normalized_dimensions ?? "-"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={mapping.is_active ? "secondary" : "outline"}
                    >
                      {mapping.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <ProductMappingActiveAction
                      isActive={mapping.is_active}
                      mappingId={mapping.id}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ReverseUsageView mappings={mappings} />
    </div>
  )
}

function CreateProductMappingDialog({
  masterItems,
  mappings,
  products,
}: {
  masterItems: ProductMappingMasterItem[]
  mappings: ProductMapping[]
  products: ProductMappingProduct[]
}) {
  const [state, formAction, isPending] = useActionState(
    createProductMappingAction,
    initialProductMappingActionState,
  )
  useActionStateToast(state)
  const [masterItemId, setMasterItemId] = useState("")
  const [productId, setProductId] = useState("")
  const existingMapping = mappings.find(
    (mapping) =>
      mapping.masterItem.id === masterItemId &&
      mapping.product.id === productId,
  )
  const isDuplicate = existingMapping?.is_active ?? false

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Link2Icon data-icon="inline-start" />
          Hubungkan produk
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Hubungkan produk ke Master Item</DialogTitle>
          <DialogDescription>
            Satu produk dapat dipakai banyak Master Item. Pasangan yang sama
            hanya boleh memiliki satu mapping.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-5" noValidate>
          <input name="masterItemId" type="hidden" value={masterItemId} />
          <input name="productId" type="hidden" value={productId} />
          {state.error ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          {isDuplicate || existingMapping ? (
            <Alert>
              <CircleAlertIcon />
              <AlertTitle>
                {isDuplicate
                  ? "Mapping sudah ada"
                  : "Mapping akan diaktifkan kembali"}
              </AlertTitle>
              <AlertDescription>
                {isDuplicate
                  ? "Pilih pasangan Master Item dan produk yang berbeda."
                  : "Mapping lama tetap digunakan sebagai histori dan akan diaktifkan kembali."}
              </AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            <Field>
              <FieldLabel>Master Item</FieldLabel>
              <Select value={masterItemId} onValueChange={setMasterItemId}>
                <SelectTrigger aria-label="Pilih Master Item">
                  <SelectValue placeholder="Pilih Master Item aktif" />
                </SelectTrigger>
                <SelectContent>
                  {masterItems.map((masterItem) => (
                    <SelectItem key={masterItem.id} value={masterItem.id}>
                      {masterItem.part_no} - {masterItem.part_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel>Produk</FieldLabel>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger aria-label="Pilih produk">
                  <SelectValue placeholder="Pilih produk aktif" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.product_code} - {product.part_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              disabled={isPending || !masterItemId || !productId || isDuplicate}
              type="submit"
            >
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              Simpan mapping
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ProductMappingActiveAction({
  isActive,
  mappingId,
}: {
  isActive: boolean
  mappingId: string
}) {
  const [state, formAction, isPending] = useActionState(
    setProductMappingActiveAction,
    initialProductMappingActionState,
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
            <AlertDialogTitle>{actionLabel} Product Mapping?</AlertDialogTitle>
            <AlertDialogDescription>
              {isActive
                ? "Produk ini tidak lagi diizinkan untuk scan baru pada Master Item terkait. Histori dan mapping lama tetap disimpan; periksa juga requirement box yang masih memakainya."
                : "Mapping akan kembali diizinkan untuk scan baru bila Master Item dan produk masih aktif."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form action={formAction}>
            <input name="mappingId" type="hidden" value={mappingId} />
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

function ReverseUsageView({ mappings }: { mappings: ProductMapping[] }) {
  const usageByProduct = useMemo(() => {
    const usage = new Map<string, ProductMapping[]>()

    for (const mapping of mappings) {
      const entries = usage.get(mapping.product.id) ?? []
      entries.push(mapping)
      usage.set(mapping.product.id, entries)
    }

    return [...usage.values()].sort((left, right) =>
      left[0].product.product_code.localeCompare(
        right[0].product.product_code,
        "id",
      ),
    )
  }, [mappings])

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="reverse-usage-title"
    >
      <div className="space-y-1">
        <h2 className="text-lg font-semibold" id="reverse-usage-title">
          Pemakaian balik produk
        </h2>
        <p className="text-muted-foreground text-sm">
          Lihat setiap Master Item yang memakai produk tertentu.
        </p>
      </div>
      {usageByProduct.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Belum ada pemakaian produk</EmptyTitle>
            <EmptyDescription>
              Hubungkan produk ke Master Item untuk melihat pemakaian baliknya.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produk</TableHead>
                <TableHead>Master Item yang memakai</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usageByProduct.map((usage) => {
                const product = usage[0].product

                return (
                  <TableRow key={product.id}>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">
                          {product.product_code}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {product.part_name} -{" "}
                          {product.normalized_dimensions ?? "-"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1.5">
                        {usage.map((mapping) => (
                          <Badge
                            key={mapping.id}
                            variant={
                              mapping.is_active ? "secondary" : "outline"
                            }
                          >
                            {mapping.masterItem.part_no}
                            {mapping.is_active ? "" : " (nonaktif)"}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
