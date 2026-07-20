"use client"

import { useActionState, useMemo, useState } from "react"
import {
  BoxesIcon,
  CircleAlertIcon,
  CopyIcon,
  EyeIcon,
  PencilIcon,
  PlusIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react"

import {
  cloneBoxDefinitionVersionAction,
  createBoxDefinitionAction,
  publishBoxDefinitionAction,
  updateBoxDefinitionAction,
} from "@/features/box-definitions/actions"
import { initialBoxDefinitionActionState } from "@/features/box-definitions/form-state"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
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

export type BoxDefinitionProduct = {
  id: string
  productCode: string
  partName: string
  normalizedDimensions: string | null
}

export type BoxDefinitionMasterItem = {
  id: string
  itemCode: string
  partNo: string
  partName: string
}

export type BoxDefinitionRequirement = {
  id: string
  productId: string
  expectedQty: number
  product: BoxDefinitionProduct | null
}

export type BoxDefinitionLayer = {
  id: string
  layerNo: number
  name: string
  sortOrder: number
  requirements: BoxDefinitionRequirement[]
}

export type BoxDefinition = {
  id: string
  masterItemId: string
  boxCode: string
  boxName: string
  version: number
  isActive: boolean
  masterItem: BoxDefinitionMasterItem | null
  layers: BoxDefinitionLayer[]
  isUsed: boolean
}

export type BoxDefinitionEditorRequirement = {
  id: string
  productId: string
  expectedQty: number
}

export type BoxDefinitionEditorLayer = {
  id: string
  name: string
  requirements: BoxDefinitionEditorRequirement[]
}

let nextEditorId = 0

function editorId(prefix: string) {
  nextEditorId += 1
  return `${prefix}-${nextEditorId}`
}

export function createInitialEditorLayers(): BoxDefinitionEditorLayer[] {
  return [
    {
      id: editorId("layer"),
      name: "Layer 1",
      requirements: [
        { id: editorId("requirement"), productId: "", expectedQty: 1 },
      ],
    },
  ]
}

export function addEditorLayer(layers: BoxDefinitionEditorLayer[]) {
  if (layers.length >= 10) return layers

  return [
    ...layers,
    {
      id: editorId("layer"),
      name: `Layer ${layers.length + 1}`,
      requirements: [
        { id: editorId("requirement"), productId: "", expectedQty: 1 },
      ],
    },
  ]
}

export function moveEditorLayer(
  layers: BoxDefinitionEditorLayer[],
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

export function removeEditorLayer(
  layers: BoxDefinitionEditorLayer[],
  index: number,
) {
  if (layers.length <= 1) return layers
  return layers.filter((_, layerIndex) => layerIndex !== index)
}

export function addEditorRequirement(
  layers: BoxDefinitionEditorLayer[],
  layerIndex: number,
) {
  return layers.map((layer, index) =>
    index === layerIndex
      ? {
          ...layer,
          requirements: [
            ...layer.requirements,
            { id: editorId("requirement"), productId: "", expectedQty: 1 },
          ],
        }
      : layer,
  )
}

export function editorGrandTotal(layers: BoxDefinitionEditorLayer[]) {
  return layers.reduce(
    (grandTotal, layer) =>
      grandTotal +
      layer.requirements.reduce(
        (layerTotal, requirement) => layerTotal + requirement.expectedQty,
        0,
      ),
    0,
  )
}

export function selectableProductsForRequirement(
  products: BoxDefinitionProduct[],
  requirements: BoxDefinitionEditorRequirement[],
  requirementId: string,
) {
  const selectedElsewhere = new Set(
    requirements
      .filter((requirement) => requirement.id !== requirementId)
      .map((requirement) => requirement.productId)
      .filter(Boolean),
  )

  return products.filter((product) => !selectedElsewhere.has(product.id))
}

function layerEditorState(
  definition?: BoxDefinition,
): BoxDefinitionEditorLayer[] {
  if (!definition) return createInitialEditorLayers()

  return definition.layers
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((layer) => ({
      id: layer.id,
      name: layer.name,
      requirements: layer.requirements
        .slice()
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((requirement) => ({
          id: requirement.id,
          productId: requirement.productId,
          expectedQty: requirement.expectedQty,
        })),
    }))
}

function productLabel(product: BoxDefinitionProduct) {
  return `${product.productCode} - ${product.partName}${product.normalizedDimensions ? ` (${product.normalizedDimensions})` : ""}`
}

function definitionTotal(definition: BoxDefinition) {
  return definition.layers.reduce(
    (grandTotal, layer) =>
      grandTotal +
      layer.requirements.reduce(
        (layerTotal, requirement) => layerTotal + requirement.expectedQty,
        0,
      ),
    0,
  )
}

export function BoxDefinitionDirectory({
  definitions,
  masterItems,
  mappedProducts,
}: {
  definitions: BoxDefinition[]
  masterItems: BoxDefinitionMasterItem[]
  mappedProducts: Record<string, BoxDefinitionProduct[]>
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">
          Buat draft, susun layer, lalu publikasikan setelah requirement sesuai.
        </p>
        <BoxDefinitionEditorDialog
          masterItems={masterItems}
          mappedProducts={mappedProducts}
        />
      </div>

      {definitions.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <BoxesIcon />
            <EmptyTitle>Belum ada Box Definition</EmptyTitle>
            <EmptyDescription>
              Buat definisi draft untuk mengatur requirement packing per layer.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No</TableHead>
                <TableHead>Box</TableHead>
                <TableHead>Master Item</TableHead>
                <TableHead>Ringkasan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {definitions.map((definition, index) => (
                <TableRow key={definition.id}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        {definition.boxCode} v{definition.version}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {definition.boxName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        {definition.masterItem?.partNo ?? "Master Item tidak ditemukan"}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {definition.masterItem?.partName ?? "-"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {definition.layers.length} layer · {definitionTotal(definition)} unit
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={definition.isActive ? "secondary" : "outline"}>
                        {definition.isActive ? "Aktif" : "Draft"}
                      </Badge>
                      {definition.isUsed ? <Badge variant="secondary">Dipakai</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <BoxDefinitionEditorDialog
                        definition={definition}
                        masterItems={masterItems}
                        mappedProducts={mappedProducts}
                      />
                      <CloneDefinitionAction definition={definition} />
                      {!definition.isActive ? (
                        <PublishDefinitionAction definition={definition} />
                      ) : null}
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

function BoxDefinitionEditorDialog({
  definition,
  masterItems,
  mappedProducts,
}: {
  definition?: BoxDefinition
  masterItems: BoxDefinitionMasterItem[]
  mappedProducts: Record<string, BoxDefinitionProduct[]>
}) {
  const isReadOnly = definition?.isUsed ?? false
  const [open, setOpen] = useState(false)
  const [masterItemId, setMasterItemId] = useState("")
  const [boxCode, setBoxCode] = useState("")
  const [boxName, setBoxName] = useState("")
  const [layers, setLayers] = useState<BoxDefinitionEditorLayer[]>(
    createInitialEditorLayers,
  )
  const [createState, createAction, isCreating] = useActionState(
    createBoxDefinitionAction,
    initialBoxDefinitionActionState,
  )
  const [updateState, updateAction, isUpdating] = useActionState(
    updateBoxDefinitionAction,
    initialBoxDefinitionActionState,
  )
  const state = definition ? updateState : createState
  const isPending = definition ? isUpdating : isCreating
  const formAction = definition ? updateAction : createAction
  const availableProducts = mappedProducts[masterItemId] ?? []
  const grandTotal = editorGrandTotal(layers)

  useActionStateToast(state)

  function resetForm() {
    setMasterItemId(definition?.masterItemId ?? "")
    setBoxCode(definition?.boxCode ?? "")
    setBoxName(definition?.boxName ?? "")
    setLayers(layerEditorState(definition))
  }

  function setLayerName(layerIndex: number, name: string) {
    setLayers((current) =>
      current.map((layer, index) => (index === layerIndex ? { ...layer, name } : layer)),
    )
  }

  function setRequirementProduct(
    layerIndex: number,
    requirementId: string,
    productId: string,
  ) {
    setLayers((current) =>
      current.map((layer, index) =>
        index === layerIndex
          ? {
              ...layer,
              requirements: layer.requirements.map((requirement) =>
                requirement.id === requirementId ? { ...requirement, productId } : requirement,
              ),
            }
          : layer,
      ),
    )
  }

  function setRequirementQuantity(
    layerIndex: number,
    requirementId: string,
    expectedQty: number,
  ) {
    setLayers((current) =>
      current.map((layer, index) =>
        index === layerIndex
          ? {
              ...layer,
              requirements: layer.requirements.map((requirement) =>
                requirement.id === requirementId
                  ? { ...requirement, expectedQty }
                  : requirement,
              ),
            }
          : layer,
      ),
    )
  }

  function removeRequirement(layerIndex: number, requirementId: string) {
    setLayers((current) =>
      current.map((layer, index) =>
        index === layerIndex
          ? {
              ...layer,
              requirements: layer.requirements.filter(
                (requirement) => requirement.id !== requirementId,
              ),
            }
          : layer,
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
        {definition ? (
          <Button size="sm" variant="outline">
            {isReadOnly ? <EyeIcon data-icon="inline-start" /> : <PencilIcon data-icon="inline-start" />}
            {isReadOnly ? "Lihat" : "Edit"}
          </Button>
        ) : (
          <Button>
            <PlusIcon data-icon="inline-start" />
            Buat Box Definition
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {isReadOnly
              ? `Detail ${definition?.boxCode} v${definition?.version}`
              : definition
                ? `Edit ${definition.boxCode} v${definition.version}`
                : "Buat Box Definition"}
          </DialogTitle>
          <DialogDescription>
            Produk requirement hanya tersedia bila mapping aktif untuk Master Item terpilih.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-6" noValidate>
          {definition ? <input name="boxDefinitionId" type="hidden" value={definition.id} /> : null}
          <input name="masterItemId" type="hidden" value={masterItemId} />
          <input name="boxCode" type="hidden" value={boxCode} />
          <input name="boxName" type="hidden" value={boxName} />
          <input
            name="layers"
            type="hidden"
            value={JSON.stringify(
              layers.map((layer) => ({
                name: layer.name,
                requirements: layer.requirements.map((requirement) => ({
                  productId: requirement.productId,
                  expectedQty: requirement.expectedQty,
                })),
              })),
            )}
          />
          {isReadOnly ? (
            <Alert>
              <CircleAlertIcon />
              <AlertTitle>Definisi ini sudah dipakai</AlertTitle>
              <AlertDescription>
                Perubahan tidak diizinkan agar packing session historis tetap konsisten. Buat clone untuk versi draft baru.
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
            <Field>
              <FieldLabel>Master Item</FieldLabel>
              <Select
                disabled={Boolean(definition) || isReadOnly}
                value={masterItemId}
                onValueChange={setMasterItemId}
              >
                <SelectTrigger aria-label="Pilih Master Item">
                  <SelectValue placeholder="Pilih Master Item aktif" />
                </SelectTrigger>
                <SelectContent>
                  {masterItems.map((masterItem) => (
                    <SelectItem key={masterItem.id} value={masterItem.id}>
                      {masterItem.partNo} - {masterItem.partName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="box-code">Kode box</FieldLabel>
              <Input
                disabled={isReadOnly}
                id="box-code"
                onChange={(event) => setBoxCode(event.target.value)}
                placeholder="B101"
                value={boxCode}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="box-name">Nama box</FieldLabel>
              <Input
                disabled={isReadOnly}
                id="box-name"
                onChange={(event) => setBoxName(event.target.value)}
                placeholder="B101 Sample"
                value={boxName}
              />
            </Field>
          </FieldGroup>

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-medium">Layer dan requirement</h3>
                <p className="text-muted-foreground text-sm">
                  Total seluruh layer: {grandTotal} unit
                </p>
              </div>
              {!isReadOnly ? (
                <div className="flex flex-col items-end gap-1">
                  <Button
                    disabled={layers.length >= 10}
                    onClick={() => setLayers((current) => addEditorLayer(current))}
                    type="button"
                    variant="outline"
                  >
                    <PlusIcon data-icon="inline-start" />
                    Tambah layer
                  </Button>
                  {layers.length >= 10 ? (
                    <p className="text-muted-foreground text-sm">
                      Maksimal 10 layer per box.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            {layers.map((layer, layerIndex) => {
              const layerTotal = layer.requirements.reduce(
                (total, requirement) => total + requirement.expectedQty,
                0,
              )

              return (
                <section className="rounded-lg border" key={layer.id}>
                  <div className="flex flex-col gap-4 p-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div className="flex flex-col gap-1">
                        <h4 className="font-medium">Layer {layerIndex + 1}</h4>
                        <p className="text-muted-foreground text-sm">{layerTotal} unit pada layer ini</p>
                      </div>
                      {!isReadOnly ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            disabled={layerIndex === 0}
                            onClick={() => setLayers((current) => moveEditorLayer(current, layerIndex, -1))}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            Naik
                          </Button>
                          <Button
                            disabled={layerIndex === layers.length - 1}
                            onClick={() => setLayers((current) => moveEditorLayer(current, layerIndex, 1))}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            Turun
                          </Button>
                          <Button
                            disabled={layers.length === 1}
                            onClick={() => setLayers((current) => removeEditorLayer(current, layerIndex))}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <Trash2Icon data-icon="inline-start" />
                            Hapus
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-col gap-4 px-6 pb-6">
                    <Field>
                      <FieldLabel htmlFor={`layer-name-${layer.id}`}>Nama layer</FieldLabel>
                      <Input
                        disabled={isReadOnly}
                        id={`layer-name-${layer.id}`}
                        onChange={(event) => setLayerName(layerIndex, event.target.value)}
                        value={layer.name}
                      />
                    </Field>
                    <div className="flex flex-col gap-3">
                      {layer.requirements.map((requirement) => (
                        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]" key={requirement.id}>
                          <Field>
                            <FieldLabel>Produk</FieldLabel>
                            <Select
                              disabled={isReadOnly || !masterItemId}
                              value={requirement.productId}
                              onValueChange={(productId) => setRequirementProduct(layerIndex, requirement.id, productId)}
                            >
                              <SelectTrigger aria-label={`Pilih produk ${layer.name}`}>
                                <SelectValue placeholder={masterItemId ? "Pilih produk mapped" : "Pilih Master Item dahulu"} />
                              </SelectTrigger>
                              <SelectContent>
                                {selectableProductsForRequirement(
                                  availableProducts,
                                  layer.requirements,
                                  requirement.id,
                                ).map((product) => (
                                  <SelectItem key={product.id} value={product.id}>
                                    {productLabel(product)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field>
                            <FieldLabel htmlFor={`qty-${requirement.id}`}>Qty</FieldLabel>
                            <Input
                              disabled={isReadOnly}
                              id={`qty-${requirement.id}`}
                              min={1}
                              onChange={(event) => setRequirementQuantity(layerIndex, requirement.id, Number(event.target.value))}
                              type="number"
                              value={requirement.expectedQty}
                            />
                          </Field>
                          {!isReadOnly ? (
                            <Button
                              aria-label="Hapus requirement"
                              className="self-end"
                              disabled={layer.requirements.length === 1}
                              onClick={() => removeRequirement(layerIndex, requirement.id)}
                              size="icon"
                              type="button"
                              variant="outline"
                            >
                              <Trash2Icon />
                            </Button>
                          ) : null}
                        </div>
                      ))}
                      {!isReadOnly ? (
                        <Button
                          onClick={() => setLayers((current) => addEditorRequirement(current, layerIndex))}
                          type="button"
                          variant="outline"
                        >
                          <PlusIcon data-icon="inline-start" />
                          Tambah requirement
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </section>
              )
            })}
          </div>
          <DialogFooter>
            {!isReadOnly ? (
              <Button disabled={isPending} type="submit">
                {isPending ? <Spinner data-icon="inline-start" /> : null}
                {definition ? "Simpan perubahan" : "Buat draft"}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PublishDefinitionAction({ definition }: { definition: BoxDefinition }) {
  const [state, formAction, isPending] = useActionState(
    publishBoxDefinitionAction,
    initialBoxDefinitionActionState,
  )

  useActionStateToast(state)

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline">
          <SendIcon data-icon="inline-start" />
          Publikasikan
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Publikasikan {definition.boxCode} v{definition.version}?</AlertDialogTitle>
          <AlertDialogDescription>
            Publikasi mengaktifkan versi ini setelah validasi database memastikan seluruh layer dan requirement lengkap.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {state.error ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}
        <form action={formAction}>
          <input name="boxDefinitionId" type="hidden" value={definition.id} />
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button disabled={isPending} type="submit">
                {isPending ? <Spinner data-icon="inline-start" /> : null}
                Publikasikan
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CloneDefinitionAction({ definition }: { definition: BoxDefinition }) {
  const [state, formAction, isPending] = useActionState(
    cloneBoxDefinitionVersionAction,
    initialBoxDefinitionActionState,
  )

  useActionStateToast(state)

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline">
          <CopyIcon data-icon="inline-start" />
          Clone versi
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clone {definition.boxCode} v{definition.version}?</AlertDialogTitle>
          <AlertDialogDescription>
            Sistem akan menyalin urutan layer dan requirement ke versi draft berikutnya. Versi asal tidak berubah.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {state.error ? (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}
        <form action={formAction}>
          <input name="boxDefinitionId" type="hidden" value={definition.id} />
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button disabled={isPending} type="submit">
                {isPending ? <Spinner data-icon="inline-start" /> : null}
                Clone draft
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
