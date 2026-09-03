"use client"

import { useActionState, useMemo, useState } from "react"
import Link from "next/link"
import {
  BanIcon,
  BoxIcon,
  CheckIcon,
  CircleAlertIcon,
  EyeIcon,
  FilterIcon,
  HistoryIcon,
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
  productLabel,
  type LayerProductSelections,
  type MasterItemBox,
  type ProductOption,
} from "@/features/master-items/components/master-item-box-layer-editor"
import { changedLayerSelections } from "@/features/master-items/box-layer-requirements"
import { shortenLayerName } from "@/features/master-items/layer-label"
import { initialMasterItemActionState } from "@/features/master-items/form-state"
import {
  useActionStateToast,
  useCloseOnActionSuccess,
} from "@/components/shared/action-state-toast"
import { PaginationControls } from "@/components/shared/pagination-controls"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  /**
   * Nomor urut dinamis: posisi Master Item di dalam daftar yang diurutkan
   * item_code, dihitung Postgres. Nomor inilah yang dipakai QR label box saat
   * batch dibuat, dan ia bergeser saat Master Item lain ditambah atau dihapus.
   */
  row_no: number | null
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
  const [page, setPage] = useState(1)

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

    // Nomor urut naik, tetap. Menu Urutkan dibuang, jadi tidak ada lagi cara
    // mengubahnya dari layar -- dan nomor urut itulah urutan yang dipakai
    // orang untuk menyebut Master Item, jadi tabel yang mengikutinya bisa
    // ditelusuri dengan jari tanpa membaca kolom lain.
    return [...filtered].sort((a, b) => (a.row_no ?? 0) - (b.row_no ?? 0))
  }, [masterItems, query, status])

  const pageCount = Math.max(
    1,
    Math.ceil(filteredMasterItems.length / PAGE_SIZE),
  )
  const currentPage = Math.min(page, pageCount)
  const pagedMasterItems = filteredMasterItems.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

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
                <TableHead className="w-16">No urut</TableHead>
                <TableHead>Master Item</TableHead>
                <TableHead>Unit / Qty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedMasterItems.map((masterItem) => (
                <TableRow key={masterItem.id}>
                  {/* Nomor urut yang akan dipakai QR label box, bukan nomor
                      baris di layar: nomor baris berubah begitu daftarnya
                      disaring atau dihalamankan. */}
                  <TableCell className="tabular-nums">
                    {masterItem.row_no ?? "—"}
                  </TableCell>
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
                      <MasterItemDetailDialog
                        boxes={boxes}
                        masterItem={masterItem}
                        products={products}
                        suppliers={suppliers}
                      />
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={`/admin/master-items/${masterItem.id}/history`}
                        >
                          <HistoryIcon data-icon="inline-start" />
                          Lihat History
                        </Link>
                      </Button>
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

function MasterItemDetailDialog({
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
  const ownBoxes = boxes
    .filter((box) => box.masterItemId === masterItem.id)
    .sort((first, second) => first.boxNo - second.boxNo)
  const supplier =
    suppliers.find((candidate) => candidate.id === masterItem.supplier_id) ??
    null

  // Halaman scan hanya menawarkan Master Item aktif yang sudah punya Box, jadi
  // tombolnya dikunci di sini agar operator tidak mendarat di dialog kosong.
  const canUseForLabelBox = masterItem.is_active && ownBoxes.length > 0
  const blockedReason = !masterItem.is_active
    ? "Master Item nonaktif tidak dapat dipakai membuat label box."
    : "Tambahkan minimal satu Box sebelum membuat label box."

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <EyeIcon data-icon="inline-start" />
          Lihat Data
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{masterItem.part_no}</DialogTitle>
          <DialogDescription>{masterItem.part_name}</DialogDescription>
        </DialogHeader>

        <dl className="grid gap-4 sm:grid-cols-2">
          <DetailRow label="Kode item" value={masterItem.item_code} />
          <DetailRow
            label="Supplier"
            value={
              supplier
                ? `${supplier.supplier_code} — ${supplier.supplier_name}`
                : "Tanpa supplier"
            }
          />
          <DetailRow label="Unit" value={masterItem.unit} />
          <DetailRow
            label="Packing Qty"
            value={String(masterItem.default_label_qty)}
          />
          <DetailRow
            label="Status"
            value={masterItem.is_active ? "Aktif" : "Nonaktif"}
          />
          <DetailRow label="Jumlah Box" value={`${ownBoxes.length} Box`} />
        </dl>

        <div className="flex flex-col gap-3 border-t pt-5">
          <h3 className="text-sm font-medium">Box dan Layer</h3>
          {ownBoxes.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Belum ada Box. Tambahkan lewat Edit Master Item.
            </p>
          ) : (
            ownBoxes.map((box) => (
              <section
                className="flex flex-col gap-2 rounded-lg border p-4"
                key={box.id}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="font-medium">{box.boxName}</h4>
                  {box.hasOngoingWork ? (
                    <Badge variant="secondary">Sedang dipakai</Badge>
                  ) : box.hasHistory ? (
                    <Badge variant="outline">Pernah dipakai</Badge>
                  ) : null}
                </div>
                {box.layers.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    Belum ada layer.
                  </p>
                ) : (
                  box.layers.map((layer) => {
                    const layerProducts = layer.requirements
                      .map((requirement) =>
                        products.find(
                          (product) => product.id === requirement.productId,
                        ),
                      )
                      .filter((product) => product !== undefined)
                    return (
                      <div className="rounded-md border p-3" key={layer.id}>
                        <p className="mb-2 text-sm font-medium">
                          Layer {layer.layerNo} ·{" "}
                          {shortenLayerName(layer.layerName)}
                        </p>
                        {layerProducts.length === 0 ? (
                          <p className="text-muted-foreground text-sm">
                            Belum ada produk dipilih.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {layerProducts.map((product) => (
                              <span
                                className="bg-secondary text-secondary-foreground rounded-md border px-2 py-1 text-sm"
                                key={product.id}
                              >
                                {productLabel(product)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </section>
            ))
          )}
        </div>

        {canUseForLabelBox ? null : (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertDescription>{blockedReason}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button asChild={canUseForLabelBox} disabled={!canUseForLabelBox}>
            {canUseForLabelBox ? (
              <Link href={`/scan?masterItemId=${masterItem.id}`}>
                <BoxIcon data-icon="inline-start" />
                Gunakan untuk Label Box
              </Link>
            ) : (
              <>
                <BoxIcon data-icon="inline-start" />
                Gunakan untuk Label Box
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  )
}

function CreateMasterItemDialog({
  suppliers,
}: {
  suppliers: SupplierOption[]
}) {
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

  // Pembanding untuk mencari layer yang benar-benar disentuh. Diturunkan dari
  // props, bukan disimpan sekali di state: setelah simpanan berhasil halaman
  // direvalidasi dan `boxes` membawa nilai terbaru, jadi simpanan berikutnya
  // tidak mengirim ulang layer yang sudah sama.
  const savedSelections = useMemo(
    () => initialLayerProductSelections(boxes, masterItem.id),
    [boxes, masterItem.id],
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
          layerRequirementsJson={layerProductSelectionsToPayload(
            changedLayerSelections(savedSelections, selections),
          )}
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
              Tindakan ini permanen. Box Definition beserta layernya dan product
              mapping milik Master Item ini ikut terhapus. Riwayat label box dan
              packing session yang sudah ada tetap tersimpan dengan data
              lamanya.
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
