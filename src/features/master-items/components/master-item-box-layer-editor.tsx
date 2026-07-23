"use client"

import { useActionState, useState } from "react"
import { CircleAlertIcon, PlusIcon, Trash2Icon } from "lucide-react"

import {
  createBoxLayerAction,
  createMasterItemBoxAction,
  deleteBoxLayerAction,
  deleteMasterItemBoxAction,
  saveBoxLayerRequirementsAction,
} from "@/features/master-items/actions"
import { initialMasterItemActionState } from "@/features/master-items/form-state"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
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

export type BoxLayerRequirement = {
  productId: string
  expectedQty: number
}

export type BoxLayer = {
  id: string
  layerNo: number
  layerName: string
  requirements: BoxLayerRequirement[]
}

export type MasterItemBox = {
  id: string
  masterItemId: string
  boxNo: number
  boxCode: string
  boxName: string
  isUsed: boolean
  layers: BoxLayer[]
}

function productLabel(product: ProductOption) {
  return `${product.productCode} - ${product.partName}${product.normalizedDimensions ? ` (${product.normalizedDimensions})` : ""}`
}

export function MasterItemBoxLayerEditor({
  masterItem,
  boxes,
  products,
}: {
  masterItem: MasterItem
  boxes: MasterItemBox[]
  products: ProductOption[]
}) {
  const ownBoxes = boxes
    .filter((box) => box.masterItemId === masterItem.id)
    .sort((a, b) => a.boxNo - b.boxNo)

  const [createBoxState, createBoxAction, isCreatingBox] = useActionState(
    createMasterItemBoxAction,
    initialMasterItemActionState,
  )
  useActionStateToast(createBoxState)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Kelola Box
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Box dan Layer</DialogTitle>
          <DialogDescription>
            {masterItem.item_code} · {masterItem.part_no} · {masterItem.part_name}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {ownBoxes.map((box) => (
            <BoxCard
              box={box}
              itemCode={masterItem.item_code}
              key={box.id}
              products={products}
            />
          ))}

          <form action={createBoxAction}>
            <input name="masterItemId" type="hidden" value={masterItem.id} />
            <Button
              disabled={isCreatingBox || ownBoxes.length >= 3}
              type="submit"
              variant="outline"
            >
              {isCreatingBox ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              Tambah Box {ownBoxes.length >= 3 ? "(maksimal 3)" : ""}
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function BoxCard({
  box,
  itemCode,
  products,
}: {
  box: MasterItemBox
  itemCode: string
  products: ProductOption[]
}) {
  const [deleteBoxState, deleteBoxAction, isDeletingBox] = useActionState(
    deleteMasterItemBoxAction,
    initialMasterItemActionState,
  )
  const [createLayerState, createLayerAction, isCreatingLayer] = useActionState(
    createBoxLayerAction,
    initialMasterItemActionState,
  )
  useActionStateToast(deleteBoxState)
  useActionStateToast(createLayerState)

  const sortedLayers = box.layers.slice().sort((a, b) => a.layerNo - b.layerNo)
  const highestLayerNo = sortedLayers.at(-1)?.layerNo ?? 0

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">
            {itemCode} - {box.boxName}
          </h3>
          <p className="text-muted-foreground text-xs">
            ID: {box.boxCode}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {box.isUsed ? <Badge variant="secondary">Terpakai</Badge> : null}
          {!box.isUsed ? (
            <form action={deleteBoxAction}>
              <input name="boxId" type="hidden" value={box.id} />
              <Button
                disabled={isDeletingBox}
                size="sm"
                type="submit"
                variant="destructive"
              >
                {isDeletingBox ? <Spinner data-icon="inline-start" /> : (
                  <Trash2Icon data-icon="inline-start" />
                )}
                Hapus Box
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {deleteBoxState.error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{deleteBoxState.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3">
        {sortedLayers.map((layer) => (
          <LayerCard
            box={box}
            highestLayerNo={highestLayerNo}
            itemCode={itemCode}
            key={layer.id}
            layer={layer}
            products={products}
          />
        ))}
      </div>

      {!box.isUsed ? (
        <form action={createLayerAction}>
          <input name="boxId" type="hidden" value={box.id} />
          <Button
            disabled={isCreatingLayer || sortedLayers.length >= 10}
            size="sm"
            type="submit"
            variant="outline"
          >
            {isCreatingLayer ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <PlusIcon data-icon="inline-start" />
            )}
            Tambah Layer {sortedLayers.length >= 10 ? "(maksimal 10)" : ""}
          </Button>
        </form>
      ) : null}
      {createLayerState.error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{createLayerState.error}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}

function LayerCard({
  box,
  highestLayerNo,
  itemCode,
  layer,
  products,
}: {
  box: MasterItemBox
  highestLayerNo: number
  itemCode: string
  layer: BoxLayer
  products: ProductOption[]
}) {
  const [requirements, setRequirements] = useState<BoxLayerRequirement[]>(
    layer.requirements.length > 0
      ? layer.requirements
      : [{ productId: "", expectedQty: 1 }],
  )
  const [deleteLayerState, deleteLayerAction, isDeletingLayer] = useActionState(
    deleteBoxLayerAction,
    initialMasterItemActionState,
  )
  const [saveState, saveAction, isSaving] = useActionState(
    saveBoxLayerRequirementsAction,
    initialMasterItemActionState,
  )
  useActionStateToast(deleteLayerState)
  useActionStateToast(saveState)

  const canDeleteLayer = !box.isUsed && layer.layerNo === highestLayerNo

  function updateRequirement(
    index: number,
    update: Partial<{ productId: string; expectedQty: number }>,
  ) {
    setRequirements(
      requirements.map((requirement, requirementIndex) =>
        requirementIndex === index
          ? { ...requirement, ...update }
          : requirement,
      ),
    )
  }

  function addRequirement() {
    setRequirements([...requirements, { productId: "", expectedQty: 1 }])
  }

  function removeRequirement(index: number) {
    if (requirements.length <= 1) return
    setRequirements(requirements.filter((_, requirementIndex) => requirementIndex !== index))
  }

  const selectedElsewhere = (indexToKeep: number) =>
    new Set(
      requirements
        .filter((_, index) => index !== indexToKeep)
        .map((requirement) => requirement.productId)
        .filter(Boolean),
    )

  return (
    <div className="rounded-md border p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium">
          {itemCode} - {layer.layerName}
        </h4>
        {canDeleteLayer ? (
          <form action={deleteLayerAction}>
            <input name="boxLayerId" type="hidden" value={layer.id} />
            <Button
              disabled={isDeletingLayer}
              size="sm"
              type="submit"
              variant="outline"
            >
              {isDeletingLayer ? <Spinner data-icon="inline-start" /> : (
                <Trash2Icon data-icon="inline-start" />
              )}
              Hapus Layer
            </Button>
          </form>
        ) : null}
      </div>

      {deleteLayerState.error ? (
        <Alert className="mb-3" variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{deleteLayerState.error}</AlertDescription>
        </Alert>
      ) : null}
      {saveState.error ? (
        <Alert className="mb-3" variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{saveState.error}</AlertDescription>
        </Alert>
      ) : null}

      <form action={saveAction} className="flex flex-col gap-3">
        <input name="boxLayerId" type="hidden" value={layer.id} />
        <input
          name="requirements"
          type="hidden"
          value={JSON.stringify(requirements)}
        />
        {requirements.map((requirement, index) => (
          <div
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]"
            key={`${layer.id}-${index}`}
          >
            <Field>
              <FieldLabel>Produk</FieldLabel>
              <Select
                disabled={box.isUsed}
                onValueChange={(productId) =>
                  updateRequirement(index, { productId })
                }
                value={requirement.productId}
              >
                <SelectTrigger aria-label={`Pilih produk ${layer.layerName}`}>
                  <SelectValue placeholder="Pilih produk aktif" />
                </SelectTrigger>
                <SelectContent>
                  {products
                    .filter(
                      (product) => !selectedElsewhere(index).has(product.id),
                    )
                    .map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {productLabel(product)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`qty-${layer.id}-${index}`}>Qty</FieldLabel>
              <Input
                disabled={box.isUsed}
                id={`qty-${layer.id}-${index}`}
                min={1}
                onChange={(event) =>
                  updateRequirement(index, {
                    expectedQty: Number(event.target.value),
                  })
                }
                type="number"
                value={requirement.expectedQty}
              />
            </Field>
            {!box.isUsed ? (
              <Button
                aria-label="Hapus requirement"
                className="self-end"
                disabled={requirements.length === 1}
                onClick={() => removeRequirement(index)}
                size="icon"
                type="button"
                variant="outline"
              >
                <Trash2Icon />
              </Button>
            ) : null}
          </div>
        ))}

        {!box.isUsed ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={addRequirement} type="button" variant="outline">
              <PlusIcon data-icon="inline-start" />
              Tambah produk
            </Button>
            <Button disabled={isSaving} type="submit">
              {isSaving ? <Spinner data-icon="inline-start" /> : null}
              Simpan produk layer ini
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  )
}
