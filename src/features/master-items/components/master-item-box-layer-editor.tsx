"use client"

import { useActionState, useMemo, useState } from "react"
import { CircleAlertIcon, CopyIcon, PlusIcon, SendIcon, Trash2Icon } from "lucide-react"

import {
  cloneMasterItemBoxVersionAction,
  createMasterItemBoxAction,
  publishMasterItemBoxAction,
  saveMasterItemBoxRequirementsAction,
} from "@/features/master-items/actions"
import { initialMasterItemActionState } from "@/features/master-items/form-state"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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

export type ProductOption = {
  id: string
  productCode: string
  partName: string
  outerDiameter: number | null
  innerDiameter: number | null
  length: number | null
  normalizedDimensions: string | null
}

export type BoxLayerOption = {
  id: string
  layerNo: number
  name: string
}

export type BoxOption = {
  id: string
  boxCode: string
  boxName: string
  layers: BoxLayerOption[]
}

export type MasterItemBoxRequirement = {
  productId: string
  expectedQty: number
}

export type MasterItemBoxAssignment = {
  id: string
  masterItemId: string
  boxId: string
  version: number
  isActive: boolean
  isUsed: boolean
  requirementsByLayer: Record<string, MasterItemBoxRequirement[]>
}

type EditorRequirement = {
  id: string
  productId: string
  expectedQty: number
}

type EditorLayer = {
  boxLayerId: string
  layerNo: number
  name: string
  requirements: EditorRequirement[]
}

let nextRequirementId = 0
function requirementId() {
  nextRequirementId += 1
  return `requirement-${nextRequirementId}`
}

function productLabel(product: ProductOption) {
  return `${product.productCode} - ${product.partName}${product.normalizedDimensions ? ` (${product.normalizedDimensions})` : ""}`
}

function editorLayersFromBox(
  box: BoxOption | undefined,
  assignment: MasterItemBoxAssignment | undefined,
): EditorLayer[] {
  if (!box) return []

  return box.layers
    .slice()
    .sort((a, b) => a.layerNo - b.layerNo)
    .map((layer) => {
      const existing = assignment?.requirementsByLayer[layer.id]
      const requirements: EditorRequirement[] =
        existing && existing.length > 0
          ? existing.map((requirement) => ({
              id: requirementId(),
              productId: requirement.productId,
              expectedQty: requirement.expectedQty,
            }))
          : [{ id: requirementId(), productId: "", expectedQty: 1 }]

      return {
        boxLayerId: layer.id,
        layerNo: layer.layerNo,
        name: layer.name,
        requirements,
      }
    })
}

function selectableProducts(
  products: ProductOption[],
  requirements: EditorRequirement[],
  requirementIdToKeep: string,
) {
  const selectedElsewhere = new Set(
    requirements
      .filter((requirement) => requirement.id !== requirementIdToKeep)
      .map((requirement) => requirement.productId)
      .filter(Boolean),
  )
  return products.filter((product) => !selectedElsewhere.has(product.id))
}

function assignmentSortKey(assignment: MasterItemBoxAssignment) {
  return assignment.isActive ? 0 : 1
}

export function MasterItemBoxLayerEditor({
  masterItem,
  boxes,
  masterItemBoxes,
  products,
}: {
  masterItem: MasterItem
  boxes: BoxOption[]
  masterItemBoxes: MasterItemBoxAssignment[]
  products: ProductOption[]
}) {
  const [open, setOpen] = useState(false)
  const [boxId, setBoxId] = useState("")
  const [masterItemBoxId, setMasterItemBoxId] = useState("")
  const [layers, setLayers] = useState<EditorLayer[]>([])

  const ownAssignments = useMemo(
    () => masterItemBoxes.filter((assignment) => assignment.masterItemId === masterItem.id),
    [masterItemBoxes, masterItem.id],
  )
  const assignmentsForBox = useMemo(
    () =>
      ownAssignments
        .filter((assignment) => assignment.boxId === boxId)
        .sort((a, b) => assignmentSortKey(a) - assignmentSortKey(b) || b.version - a.version),
    [ownAssignments, boxId],
  )
  const selectedBox = boxes.find((box) => box.id === boxId)
  const selectedAssignment = assignmentsForBox.find(
    (assignment) => assignment.id === masterItemBoxId,
  )
  const isNewAssignment = Boolean(boxId) && !selectedAssignment
  const isReadOnly = selectedAssignment?.isUsed ?? false

  const [createState, createAction, isCreating] = useActionState(
    createMasterItemBoxAction,
    initialMasterItemActionState,
  )
  const [saveState, saveAction, isSaving] = useActionState(
    saveMasterItemBoxRequirementsAction,
    initialMasterItemActionState,
  )
  const [publishState, publishAction, isPublishing] = useActionState(
    publishMasterItemBoxAction,
    initialMasterItemActionState,
  )
  const [cloneState, cloneAction, isCloning] = useActionState(
    cloneMasterItemBoxVersionAction,
    initialMasterItemActionState,
  )

  useActionStateToast(createState)
  useActionStateToast(saveState)
  useActionStateToast(publishState)
  useActionStateToast(cloneState)

  const formAction = isReadOnly ? cloneAction : isNewAssignment ? createAction : saveAction
  const isPending = isReadOnly ? isCloning : isNewAssignment ? isCreating : isSaving
  const formError = isReadOnly
    ? cloneState.error
    : isNewAssignment
      ? createState.error
      : saveState.error

  function selectBox(nextBoxId: string) {
    const box = boxes.find((candidate) => candidate.id === nextBoxId)
    const assignments = ownAssignments
      .filter((assignment) => assignment.boxId === nextBoxId)
      .sort((a, b) => assignmentSortKey(a) - assignmentSortKey(b) || b.version - a.version)
    const defaultAssignment = assignments[0]

    setBoxId(nextBoxId)
    setMasterItemBoxId(defaultAssignment?.id ?? "")
    setLayers(editorLayersFromBox(box, defaultAssignment))
  }

  function selectAssignment(nextMasterItemBoxId: string) {
    const assignment = assignmentsForBox.find((candidate) => candidate.id === nextMasterItemBoxId)
    setMasterItemBoxId(nextMasterItemBoxId)
    setLayers(editorLayersFromBox(selectedBox, assignment))
  }

  function resetForm() {
    setBoxId("")
    setMasterItemBoxId("")
    setLayers([])
  }

  function setRequirementField(
    layerBoxLayerId: string,
    reqId: string,
    update: Partial<EditorRequirement>,
  ) {
    setLayers((current) =>
      current.map((layer) =>
        layer.boxLayerId === layerBoxLayerId
          ? {
              ...layer,
              requirements: layer.requirements.map((requirement) =>
                requirement.id === reqId ? { ...requirement, ...update } : requirement,
              ),
            }
          : layer,
      ),
    )
  }

  function addRequirement(layerBoxLayerId: string) {
    setLayers((current) =>
      current.map((layer) =>
        layer.boxLayerId === layerBoxLayerId
          ? {
              ...layer,
              requirements: [
                ...layer.requirements,
                { id: requirementId(), productId: "", expectedQty: 1 },
              ],
            }
          : layer,
      ),
    )
  }

  function removeRequirement(layerBoxLayerId: string, reqId: string) {
    setLayers((current) =>
      current.map((layer) =>
        layer.boxLayerId === layerBoxLayerId && layer.requirements.length > 1
          ? {
              ...layer,
              requirements: layer.requirements.filter((requirement) => requirement.id !== reqId),
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
        <Button size="sm" variant="outline">
          Atur produk per layer
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Produk per Box dan Layer</DialogTitle>
          <DialogDescription>
            {masterItem.part_no} · {masterItem.part_name}
          </DialogDescription>
        </DialogHeader>

        {boxes.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>Belum ada Box aktif</EmptyTitle>
              <EmptyDescription>
                Buat Box di halaman Box sebelum mengatur produk per layer.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <form action={formAction} className="flex flex-col gap-5" noValidate>
            <input name="masterItemId" type="hidden" value={masterItem.id} />
            {isNewAssignment ? (
              <input name="boxId" type="hidden" value={boxId} />
            ) : (
              <input name="masterItemBoxId" type="hidden" value={masterItemBoxId} />
            )}
            <input
              name="layers"
              type="hidden"
              value={JSON.stringify(
                layers.map((layer) => ({
                  boxLayerId: layer.boxLayerId,
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
                <AlertTitle>Assignment ini sudah dipakai</AlertTitle>
                <AlertDescription>
                  Requirement ditampilkan hanya-baca agar packing session
                  historis tetap konsisten. Clone versi untuk membuat draft
                  baru.
                </AlertDescription>
              </Alert>
            ) : null}
            {formError ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
            {publishState.error ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertDescription>{publishState.error}</AlertDescription>
              </Alert>
            ) : null}

            <FieldGroup>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel>Box</FieldLabel>
                  <Select value={boxId} onValueChange={selectBox}>
                    <SelectTrigger aria-label="Pilih Box">
                      <SelectValue placeholder="Pilih Box aktif" />
                    </SelectTrigger>
                    <SelectContent>
                      {boxes.map((box) => (
                        <SelectItem key={box.id} value={box.id}>
                          {box.boxCode} · {box.boxName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Assignment</FieldLabel>
                  <Select
                    disabled={!boxId}
                    value={isNewAssignment ? "__new__" : masterItemBoxId}
                    onValueChange={(value) =>
                      value === "__new__"
                        ? selectAssignment("")
                        : selectAssignment(value)
                    }
                  >
                    <SelectTrigger aria-label="Pilih versi assignment">
                      <SelectValue placeholder="Pilih assignment" />
                    </SelectTrigger>
                    <SelectContent>
                      {assignmentsForBox.map((assignment) => (
                        <SelectItem key={assignment.id} value={assignment.id}>
                          v{assignment.version}
                          {assignment.isActive ? " · Aktif" : " · Draft"}
                        </SelectItem>
                      ))}
                      <SelectItem value="__new__">+ Assignment baru</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </FieldGroup>

            {selectedAssignment ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={selectedAssignment.isActive ? "secondary" : "outline"}>
                  {selectedAssignment.isActive ? "Aktif" : "Draft"}
                </Badge>
                {selectedAssignment.isUsed ? (
                  <Badge variant="secondary">Dipakai</Badge>
                ) : null}
              </div>
            ) : null}

            {layers.map((layer) => (
              <section className="flex flex-col gap-4 rounded-lg border p-4" key={layer.boxLayerId}>
                <h3 className="font-medium">
                  Layer {layer.layerNo}: {layer.name}
                </h3>
                <div className="flex flex-col gap-3">
                  {layer.requirements.map((requirement) => (
                    <div
                      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]"
                      key={requirement.id}
                    >
                      <Field>
                        <FieldLabel>Produk</FieldLabel>
                        <Select
                          disabled={isReadOnly}
                          value={requirement.productId}
                          onValueChange={(productId) =>
                            setRequirementField(layer.boxLayerId, requirement.id, { productId })
                          }
                        >
                          <SelectTrigger aria-label={`Pilih produk ${layer.name}`}>
                            <SelectValue placeholder="Pilih produk aktif" />
                          </SelectTrigger>
                          <SelectContent>
                            {selectableProducts(
                              products,
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
                          onChange={(event) =>
                            setRequirementField(layer.boxLayerId, requirement.id, {
                              expectedQty: Number(event.target.value),
                            })
                          }
                          type="number"
                          value={requirement.expectedQty}
                        />
                      </Field>
                      {!isReadOnly ? (
                        <Button
                          aria-label="Hapus requirement"
                          className="self-end"
                          disabled={layer.requirements.length === 1}
                          onClick={() => removeRequirement(layer.boxLayerId, requirement.id)}
                          size="icon"
                          type="button"
                          variant="outline"
                        >
                          <Trash2Icon />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
                {!isReadOnly ? (
                  <Button
                    onClick={() => addRequirement(layer.boxLayerId)}
                    type="button"
                    variant="outline"
                  >
                    <PlusIcon data-icon="inline-start" />
                    Tambah requirement
                  </Button>
                ) : null}
              </section>
            ))}

            <DialogFooter className="flex-wrap gap-2">
              {selectedAssignment && !selectedAssignment.isActive && !isReadOnly ? (
                <Button
                  disabled={isPublishing}
                  formAction={publishAction}
                  type="submit"
                  variant="outline"
                >
                  {isPublishing ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
                  Publikasikan
                </Button>
              ) : null}
              {isReadOnly ? (
                <Button disabled={isCloning} type="submit" variant="outline">
                  {isCloning ? <Spinner data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
                  Clone versi
                </Button>
              ) : (
                <Button disabled={isPending || layers.length === 0} type="submit">
                  {isPending ? <Spinner data-icon="inline-start" /> : null}
                  Simpan produk per layer
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
