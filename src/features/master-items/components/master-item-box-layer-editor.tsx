"use client"

import { useActionState, useState } from "react"
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CircleAlertIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"

import {
  createBoxLayerAction,
  createMasterItemBoxAction,
  deleteBoxLayerAction,
  deleteMasterItemBoxAction,
} from "@/features/master-items/actions"
import { initialMasterItemActionState } from "@/features/master-items/form-state"
import { shortenLayerName } from "@/features/master-items/layer-label"
import { formatProductPreview } from "@/features/products/validation"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  /** Mengunci penyuntingan: masih ada kiriman yang belum selesai. */
  hasOngoingWork: boolean
  /** Pernah dipakai kiriman yang sudah selesai; hanya keterangan. */
  hasHistory: boolean
  layers: BoxLayer[]
}

/** boxLayerId -> selected product ids (checked = requirement, qty always 1) */
export type LayerProductSelections = Record<string, string[]>

export function initialLayerProductSelections(
  boxes: MasterItemBox[],
  masterItemId: string,
): LayerProductSelections {
  const selections: LayerProductSelections = {}
  for (const box of boxes) {
    if (box.masterItemId !== masterItemId) continue
    for (const layer of box.layers) {
      selections[layer.id] = layer.requirements.map(
        (requirement) => requirement.productId,
      )
    }
  }
  return selections
}

export function layerProductSelectionsToPayload(
  selections: LayerProductSelections,
) {
  return JSON.stringify(
    Object.entries(selections).map(([boxLayerId, productIds]) => ({
      boxLayerId,
      productIds,
    })),
  )
}

export function productLabel(product: ProductOption) {
  if (
    product.outerDiameter === null ||
    product.innerDiameter === null ||
    product.length === null
  ) {
    return product.partName
  }
  return formatProductPreview(
    product.partName,
    product.outerDiameter,
    product.innerDiameter,
    product.length,
  )
}

export function MasterItemBoxLayerFields({
  masterItem,
  boxes,
  products,
  selections,
  onToggleProduct,
}: {
  masterItem: MasterItem
  boxes: MasterItemBox[]
  products: ProductOption[]
  selections: LayerProductSelections
  onToggleProduct: (boxLayerId: string, productId: string) => void
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
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium">Box dan Layer</h3>
        <p className="text-muted-foreground text-xs">
          Maksimal 3 Box per Master Item. Centang produk untuk menambahkan ke
          layer.
        </p>
      </div>

      {ownBoxes.map((box) => (
        <BoxCard
          box={box}
          key={box.id}
          onToggleProduct={onToggleProduct}
          products={products}
          selections={selections}
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
  )
}

function BoxCard({
  box,
  onToggleProduct,
  products,
  selections,
}: {
  box: MasterItemBox
  onToggleProduct: (boxLayerId: string, productId: string) => void
  products: ProductOption[]
  selections: LayerProductSelections
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
        <h3 className="font-medium">{box.boxName}</h3>
        <div className="flex items-center gap-2">
          {box.hasOngoingWork ? (
            <Badge variant="secondary">Sedang dipakai</Badge>
          ) : box.hasHistory ? (
            <Badge variant="outline">Pernah dipakai</Badge>
          ) : null}
          {!box.hasOngoingWork ? (
            <form action={deleteBoxAction}>
              <input name="boxId" type="hidden" value={box.id} />
              <Button
                disabled={isDeletingBox}
                size="sm"
                type="submit"
                variant="destructive"
              >
                {isDeletingBox ? (
                  <Spinner data-icon="inline-start" />
                ) : (
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
            key={layer.id}
            layer={layer}
            onToggleProduct={onToggleProduct}
            products={products}
            selectedProductIds={selections[layer.id] ?? []}
          />
        ))}
      </div>

      {!box.hasOngoingWork ? (
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
  layer,
  onToggleProduct,
  products,
  selectedProductIds,
}: {
  box: MasterItemBox
  highestLayerNo: number
  layer: BoxLayer
  onToggleProduct: (boxLayerId: string, productId: string) => void
  products: ProductOption[]
  selectedProductIds: string[]
}) {
  const [deleteLayerState, deleteLayerAction, isDeletingLayer] = useActionState(
    deleteBoxLayerAction,
    initialMasterItemActionState,
  )
  useActionStateToast(deleteLayerState)

  const canDeleteLayer = !box.hasOngoingWork && layer.layerNo === highestLayerNo
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const selectedProducts = products.filter((product) =>
    selectedProductIds.includes(product.id),
  )

  return (
    <div className="rounded-md border p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium">
          Layer {layer.layerNo} · {shortenLayerName(layer.layerName)}
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
              {isDeletingLayer ? (
                <Spinner data-icon="inline-start" />
              ) : (
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

      {/* Bagian 1: preview produk terpilih */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {selectedProducts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Belum ada produk dipilih.
          </p>
        ) : (
          selectedProducts.map((product) => (
            <span
              className="bg-secondary text-secondary-foreground rounded-md border px-2 py-1 text-sm"
              key={product.id}
            >
              {productLabel(product)}
            </span>
          ))
        )}
      </div>

      {/* Bagian 2: checklist produk, kolaps */}
      <Button
        className="w-full justify-between"
        onClick={() => setIsPickerOpen((open) => !open)}
        size="sm"
        type="button"
        variant="outline"
      >
        Pilih produk
        {isPickerOpen ? (
          <ChevronUpIcon className="size-4" />
        ) : (
          <ChevronDownIcon className="size-4" />
        )}
      </Button>

      {isPickerOpen ? (
        <div className="mt-2 max-h-80 columns-2 gap-x-4 overflow-y-auto rounded-md border p-2">
          {products.map((product) => (
            <label
              className="mb-2 flex break-inside-avoid items-center gap-1.5 text-sm"
              key={product.id}
            >
              <input
                checked={selectedProductIds.includes(product.id)}
                disabled={box.hasOngoingWork}
                onChange={() => onToggleProduct(layer.id, product.id)}
                type="checkbox"
              />
              <span className="truncate">{productLabel(product)}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  )
}
