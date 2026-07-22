"use client"

import { useActionState, useMemo, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  BanIcon,
  BoxesIcon,
  CheckIcon,
  CircleAlertIcon,
  FilterIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"

import {
  createBoxAction,
  deleteBoxAction,
  setBoxActiveAction,
  updateBoxAction,
} from "@/features/boxes/actions"
import { initialBoxActionState } from "@/features/boxes/form-state"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { PaginationControls } from "@/components/shared/pagination-controls"
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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

export type BoxLayer = {
  id: string
  layerNo: number
  name: string
}

export type Box = {
  id: string
  boxCode: string
  boxName: string
  isActive: boolean
  isUsed: boolean
  layers: BoxLayer[]
}

export type EditorLayer = {
  id: string
  name: string
}

let nextEditorId = 0
function editorId() {
  nextEditorId += 1
  return `layer-${nextEditorId}`
}

export function createInitialEditorLayers(box?: Box): EditorLayer[] {
  if (box) {
    return box.layers
      .slice()
      .sort((a, b) => a.layerNo - b.layerNo)
      .map((layer) => ({ id: editorId(), name: layer.name }))
  }
  return [{ id: editorId(), name: "Layer 1" }]
}

export function addEditorLayer(layers: EditorLayer[]) {
  if (layers.length >= 10) return layers
  return [...layers, { id: editorId(), name: `Layer ${layers.length + 1}` }]
}

export function removeEditorLayer(layers: EditorLayer[], index: number) {
  if (layers.length <= 1) return layers
  return layers.filter((_, layerIndex) => layerIndex !== index)
}

export function moveEditorLayer(
  layers: EditorLayer[],
  index: number,
  direction: -1 | 1,
) {
  const destination = index + direction
  if (destination < 0 || destination >= layers.length) return layers
  const next = [...layers]
  const [layer] = next.splice(index, 1)
  next.splice(destination, 0, layer)
  return next
}

type SortColumn = "box_code" | "is_active"
type SortDirection = "asc" | "desc"

const PAGE_SIZE = 20

export function BoxDirectory({ boxes }: { boxes: Box[] }) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all")
  const [sortColumn, setSortColumn] = useState<SortColumn>("box_code")
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

  const filteredBoxes = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("id-ID")

    const filtered = boxes.filter((box) => {
      const matchesQuery =
        !normalizedQuery ||
        box.boxCode.toLocaleLowerCase("id-ID").includes(normalizedQuery) ||
        box.boxName.toLocaleLowerCase("id-ID").includes(normalizedQuery)
      const matchesStatus =
        status === "all" ||
        (status === "active" ? box.isActive : !box.isActive)

      return matchesQuery && matchesStatus
    })

    const direction = sortDirection === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sortColumn === "is_active") {
        return (Number(a.isActive) - Number(b.isActive)) * direction
      }
      return (
        a.boxCode
          .toLocaleLowerCase("id-ID")
          .localeCompare(b.boxCode.toLocaleLowerCase("id-ID"), "id-ID") *
        direction
      )
    })
  }, [boxes, query, status, sortColumn, sortDirection])

  const pageCount = Math.max(1, Math.ceil(filteredBoxes.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pagedBoxes = filteredBoxes.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  const sortLabels: Record<SortColumn, string> = {
    box_code: "Box",
    is_active: "Status",
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1 sm:max-w-sm">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2 left-2.5 size-4" />
            <Input
              aria-label="Cari box"
              className="pl-8"
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
              placeholder="Cari kode atau nama box"
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
                  <SelectTrigger aria-label="Filter status box" className="w-full">
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
        <BoxEditorDialog />
      </div>

      {filteredBoxes.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <BoxesIcon />
            <EmptyTitle>Tidak ada box</EmptyTitle>
            <EmptyDescription>
              Ubah pencarian/filter atau buat box baru.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-xl border">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">No</TableHead>
                <TableHead className="w-1/3">
                  <SortableHeader
                    column="box_code"
                    label="Box"
                    onSort={toggleSort}
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                  />
                </TableHead>
                <TableHead className="w-1/4">Layer</TableHead>
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
              {pagedBoxes.map((box, index) => (
                <TableRow key={box.id}>
                  <TableCell>{(currentPage - 1) * PAGE_SIZE + index + 1}</TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium break-words">
                        {box.boxCode}
                      </span>
                      <span className="text-muted-foreground text-xs break-words">
                        {box.boxName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm whitespace-normal">
                    {box.layers.length} layer
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={box.isActive ? "secondary" : "outline"}>
                        {box.isActive ? "Aktif" : "Nonaktif"}
                      </Badge>
                      {box.isUsed ? (
                        <Badge variant="secondary">Dipakai</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex flex-wrap items-start gap-2">
                      <BoxEditorDialog box={box} />
                      <BoxActiveAction box={box} />
                      <DeleteBoxAction box={box} />
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
            totalItems={filteredBoxes.length}
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
  column: SortColumn
  label: string
  onSort: (column: SortColumn) => void
  sortColumn: SortColumn
  sortDirection: SortDirection
}) {
  const isActive = column === sortColumn
  const Icon = sortDirection === "asc" ? ArrowUpIcon : ArrowDownIcon

  return (
    <button
      className="hover:text-foreground flex items-center gap-1 font-medium"
      onClick={() => onSort(column)}
      type="button"
    >
      {label}
      {isActive ? <Icon className="size-3.5" /> : null}
    </button>
  )
}

function BoxEditorDialog({ box }: { box?: Box }) {
  const isReadOnly = box?.isUsed ?? false
  const [open, setOpen] = useState(false)
  const [boxName, setBoxName] = useState(box?.boxName ?? "")
  const [layers, setLayers] = useState<EditorLayer[]>(() =>
    createInitialEditorLayers(box),
  )
  const [createState, createAction, isCreating] = useActionState(
    createBoxAction,
    initialBoxActionState,
  )
  const [updateState, updateAction, isUpdating] = useActionState(
    updateBoxAction,
    initialBoxActionState,
  )
  const state = box ? updateState : createState
  const isPending = box ? isUpdating : isCreating
  const formAction = box ? updateAction : createAction

  useActionStateToast(state)

  function resetForm() {
    setBoxName(box?.boxName ?? "")
    setLayers(createInitialEditorLayers(box))
  }

  function setLayerName(layerIndex: number, name: string) {
    setLayers((current) =>
      current.map((layer, index) =>
        index === layerIndex ? { ...layer, name } : layer,
      ),
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) resetForm()
      }}
    >
      <DialogTrigger asChild>
        {box ? (
          <Button size="sm" variant="outline">
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
        ) : (
          <Button>
            <PlusIcon data-icon="inline-start" />
            Box baru
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{box ? `Edit ${box.boxCode}` : "Buat box"}</DialogTitle>
          <DialogDescription>
            Layer di sini adalah struktur box; produk per layer diatur dari
            halaman Master Item setelah box dipilih.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-6" noValidate>
          {box ? <input name="boxId" type="hidden" value={box.id} /> : null}
          <input name="boxName" type="hidden" value={boxName} />
          <input
            name="layers"
            type="hidden"
            value={JSON.stringify(layers.map((layer) => ({ name: layer.name })))}
          />
          {isReadOnly ? (
            <Alert>
              <CircleAlertIcon />
              <AlertTitle>Layer sudah dipakai Master Item</AlertTitle>
              <AlertDescription>
                Struktur layer terkunci agar assignment Master Item yang ada
                tetap konsisten. Nama box masih bisa diubah.
              </AlertDescription>
            </Alert>
          ) : null}
          {state.error ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="box-code">Kode box</FieldLabel>
                <Input
                  disabled
                  id="box-code"
                  value={box ? box.boxCode : "Dibuat otomatis setelah disimpan"}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="box-name">Nama box</FieldLabel>
                <Input
                  id="box-name"
                  onChange={(event) => setBoxName(event.target.value)}
                  placeholder="B101 Sample"
                  value={boxName}
                />
              </Field>
            </div>
          </FieldGroup>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">Layer</h3>
              {!isReadOnly ? (
                <Button
                  disabled={layers.length >= 10}
                  onClick={() => setLayers((current) => addEditorLayer(current))}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <PlusIcon data-icon="inline-start" />
                  Tambah layer
                </Button>
              ) : null}
            </div>
            {layers.map((layer, layerIndex) => (
              <div
                className="grid gap-3 sm:grid-cols-[1fr_auto]"
                key={layer.id}
              >
                <Field>
                  <FieldLabel htmlFor={`layer-name-${layer.id}`}>
                    Layer {layerIndex + 1}
                  </FieldLabel>
                  <Input
                    disabled={isReadOnly}
                    id={`layer-name-${layer.id}`}
                    onChange={(event) =>
                      setLayerName(layerIndex, event.target.value)
                    }
                    placeholder={`Layer ${layerIndex + 1}`}
                    value={layer.name}
                  />
                </Field>
                {!isReadOnly ? (
                  <div className="flex items-end gap-2">
                    <Button
                      disabled={layerIndex === 0}
                      onClick={() =>
                        setLayers((current) =>
                          moveEditorLayer(current, layerIndex, -1),
                        )
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Naik
                    </Button>
                    <Button
                      disabled={layerIndex === layers.length - 1}
                      onClick={() =>
                        setLayers((current) =>
                          moveEditorLayer(current, layerIndex, 1),
                        )
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Turun
                    </Button>
                    <Button
                      disabled={layers.length <= 1}
                      onClick={() =>
                        setLayers((current) =>
                          removeEditorLayer(current, layerIndex),
                        )
                      }
                      size="icon"
                      type="button"
                      variant="outline"
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button disabled={isPending} type="submit">
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              {box ? "Simpan perubahan" : "Buat box"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function BoxActiveAction({ box }: { box: Box }) {
  const [state, formAction, isPending] = useActionState(
    setBoxActiveAction,
    initialBoxActionState,
  )
  useActionStateToast(state)
  const actionLabel = box.isActive ? "Nonaktifkan" : "Aktifkan"

  return (
    <div className="flex flex-col items-start gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant={box.isActive ? "destructive" : "outline"}>
            {box.isActive ? (
              <BanIcon data-icon="inline-start" />
            ) : (
              <CheckIcon data-icon="inline-start" />
            )}
            {actionLabel}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{actionLabel} box?</AlertDialogTitle>
            <AlertDialogDescription>
              Box tidak dihapus. Master Item yang sudah memakai box ini tetap
              tersimpan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form action={formAction}>
            <input name="boxId" type="hidden" value={box.id} />
            <input name="isActive" type="hidden" value={String(!box.isActive)} />
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              <Button
                disabled={isPending}
                type="submit"
                variant={box.isActive ? "destructive" : "default"}
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

function DeleteBoxAction({ box }: { box: Box }) {
  const [state, formAction, isPending] = useActionState(
    deleteBoxAction,
    initialBoxActionState,
  )
  useActionStateToast(state)

  return (
    <div className="flex flex-col items-start gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive">
            <Trash2Icon data-icon="inline-start" />
            Hapus
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus box {box.boxCode}?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini permanen. Box yang masih dipakai Master Item tidak
              dapat dihapus.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form action={formAction}>
            <input name="boxId" type="hidden" value={box.id} />
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
