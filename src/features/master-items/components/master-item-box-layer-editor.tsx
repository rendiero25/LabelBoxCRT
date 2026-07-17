"use client"

import { useActionState, useMemo, useState } from "react"
import { CircleAlertIcon, CopyIcon, PlusIcon, Trash2Icon } from "lucide-react"

import {
  cloneBoxDefinitionVersionAction,
} from "@/features/box-definitions/actions"
import { saveMasterItemBoxRequirementsAction } from "@/features/master-items/actions"
import { initialMasterItemActionState } from "@/features/master-items/form-state"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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

export type MasterItemBoxLayerRequirement = {
  id: string
  productId: string
  expectedQty: number
}

export type MasterItemBoxLayer = {
  id: string
  layerNo: number
  name: string
  requirements: MasterItemBoxLayerRequirement[]
}

export type MasterItemBoxDefinition = {
  id: string
  masterItemId: string
  boxCode: string
  boxName: string
  version: number
  isActive: boolean
  isUsed: boolean
  layers: MasterItemBoxLayer[]
}

export function selectableBoxDefinitions(
  definitions: MasterItemBoxDefinition[],
  masterItemId: string,
) {
  return definitions.filter(
    (definition) => definition.masterItemId === masterItemId,
  )
}

export function selectableLayerNumbers(definition: MasterItemBoxDefinition) {
  return [...new Set(definition.layers.map((layer) => layer.layerNo))]
    .filter((layerNo) => layerNo >= 1 && layerNo <= 10)
    .sort((first, second) => first - second)
}

export function replaceLayerRequirements(
  layers: MasterItemBoxLayer[],
  layerId: string,
  requirements: MasterItemBoxLayerRequirement[],
) {
  return layers.map((layer) =>
    layer.id === layerId ? { ...layer, requirements } : layer,
  )
}

function productLabel(product: ProductOption) {
  return `${product.productCode} - ${product.partName}${product.normalizedDimensions ? ` (${product.normalizedDimensions})` : ""}`
}

function layersFromDefinition(
  definition: MasterItemBoxDefinition | undefined,
): MasterItemBoxLayer[] {
  return (definition?.layers ?? [])
    .slice()
    .sort((first, second) => first.layerNo - second.layerNo)
    .map((layer) => ({
      ...layer,
      requirements: layer.requirements.map((requirement) => ({ ...requirement })),
    }))
}

function selectableProducts(
  products: ProductOption[],
  requirements: MasterItemBoxLayerRequirement[],
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

let nextRequirementId = 0

function requirementId(layerId: string) {
  nextRequirementId += 1
  return `${layerId}-requirement-${nextRequirementId}`
}

export function MasterItemBoxLayerEditor({
  masterItem,
  boxDefinitions,
  products,
}: {
  masterItem: MasterItem
  boxDefinitions: MasterItemBoxDefinition[]
  products: ProductOption[]
}) {
  const [open, setOpen] = useState(false)
  const ownedDefinitions = useMemo(
    () => selectableBoxDefinitions(boxDefinitions, masterItem.id),
    [boxDefinitions, masterItem.id],
  )
  const [boxDefinitionId, setBoxDefinitionId] = useState("")
  const [selectedLayerNo, setSelectedLayerNo] = useState("")
  const [layers, setLayers] = useState<MasterItemBoxLayer[]>([])
  const [state, formAction, isPending] = useActionState(
    saveMasterItemBoxRequirementsAction,
    initialMasterItemActionState,
  )
  const [cloneState, cloneAction, isCloning] = useActionState(
    cloneBoxDefinitionVersionAction,
    initialMasterItemActionState,
  )
  const selectedDefinition = ownedDefinitions.find(
    (definition) => definition.id === boxDefinitionId,
  )
  const selectedLayer = layers.find(
    (layer) => layer.layerNo === Number(selectedLayerNo),
  )
  const isReadOnly = selectedDefinition?.isUsed ?? false

  useActionStateToast(state)
  useActionStateToast(cloneState)

  function selectDefinition(definitionId: string) {
    const definition = ownedDefinitions.find(
      (candidate) => candidate.id === definitionId,
    )
    const nextLayers = layersFromDefinition(definition)

    setBoxDefinitionId(definitionId)
    setSelectedLayerNo(
      definition ? String(selectableLayerNumbers(definition)[0] ?? "") : "",
    )
    setLayers(nextLayers)
  }

  function resetForm() {
    const definition = ownedDefinitions[0]
    const nextLayers = layersFromDefinition(definition)

    setBoxDefinitionId(definition?.id ?? "")
    setSelectedLayerNo(
      definition ? String(selectableLayerNumbers(definition)[0] ?? "") : "",
    )
    setLayers(nextLayers)
  }

  function setSelectedRequirement(
    requirementId: string,
    update: Partial<MasterItemBoxLayerRequirement>,
  ) {
    if (!selectedLayer) return

    setLayers((current) =>
      replaceLayerRequirements(
        current,
        selectedLayer.id,
        selectedLayer.requirements.map((requirement) =>
          requirement.id === requirementId ? { ...requirement, ...update } : requirement,
        ),
      ),
    )
  }

  function removeSelectedRequirement(requirementId: string) {
    if (!selectedLayer || selectedLayer.requirements.length <= 1) return

    setLayers((current) =>
      replaceLayerRequirements(
        current,
        selectedLayer.id,
        selectedLayer.requirements.filter(
          (requirement) => requirement.id !== requirementId,
        ),
      ),
    )
  }

  function addSelectedRequirement() {
    if (!selectedLayer) return

    setLayers((current) =>
      replaceLayerRequirements(current, selectedLayer.id, [
        ...selectedLayer.requirements,
        {
          id: requirementId(selectedLayer.id),
          productId: "",
          expectedQty: 1,
        },
      ]),
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

        {ownedDefinitions.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>Belum ada Box Definition</EmptyTitle>
              <EmptyDescription>
                Buat Box Definition untuk Master Item ini sebelum mengatur produk per layer.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <form
            action={isReadOnly ? cloneAction : formAction}
            className="flex flex-col gap-5"
            noValidate
          >
            <input name="masterItemId" type="hidden" value={masterItem.id} />
            <input name="boxDefinitionId" type="hidden" value={boxDefinitionId} />
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
                  Requirement ditampilkan hanya-baca agar packing session historis tetap konsisten. Clone versi untuk membuat draft baru.
                </AlertDescription>
              </Alert>
            ) : null}
            {state.error ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            ) : null}
            {cloneState.error ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertDescription>{cloneState.error}</AlertDescription>
              </Alert>
            ) : null}

            <FieldGroup>
              <Field>
                <FieldLabel>Box Definition</FieldLabel>
                <Select value={boxDefinitionId} onValueChange={selectDefinition}>
                  <SelectTrigger aria-label="Pilih Box Definition">
                    <SelectValue placeholder="Pilih Box Definition" />
                  </SelectTrigger>
                  <SelectContent>
                    {ownedDefinitions.map((definition) => (
                      <SelectItem key={definition.id} value={definition.id}>
                        {definition.boxCode} · {definition.boxName} v{definition.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Layer</FieldLabel>
                <Select
                  disabled={!selectedDefinition}
                  value={selectedLayerNo}
                  onValueChange={setSelectedLayerNo}
                >
                  <SelectTrigger aria-label="Pilih Layer">
                    <SelectValue placeholder="Pilih Layer" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedDefinition
                      ? selectableLayerNumbers(selectedDefinition).map((layerNo) => (
                          <SelectItem key={layerNo} value={String(layerNo)}>
                            Layer {layerNo}
                          </SelectItem>
                        ))
                      : null}
                  </SelectContent>
                </Select>
              </Field>
            </FieldGroup>

            {selectedLayer ? (
              <section className="flex flex-col gap-4 rounded-lg border p-4">
                <div>
                  <h3 className="font-medium">
                    Layer {selectedLayer.layerNo}: {selectedLayer.name}
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    Edit hanya requirement layer yang dipilih. Layer lain tetap ikut disimpan.
                  </p>
                </div>
                <div className="flex flex-col gap-3">
                  {selectedLayer.requirements.map((requirement) => (
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
                            setSelectedRequirement(requirement.id, { productId })
                          }
                        >
                          <SelectTrigger aria-label={`Pilih produk ${selectedLayer.name}`}>
                            <SelectValue placeholder="Pilih produk aktif" />
                          </SelectTrigger>
                          <SelectContent>
                            {selectableProducts(
                              products,
                              selectedLayer.requirements,
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
                            setSelectedRequirement(requirement.id, {
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
                          disabled={selectedLayer.requirements.length === 1}
                          onClick={() => removeSelectedRequirement(requirement.id)}
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
                    onClick={addSelectedRequirement}
                    type="button"
                    variant="outline"
                  >
                    <PlusIcon data-icon="inline-start" />
                    Tambah requirement
                  </Button>
                ) : null}
              </section>
            ) : null}

            <DialogFooter>
              {isReadOnly && selectedDefinition ? (
                <Button disabled={isCloning} type="submit" variant="outline">
                  {isCloning ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <CopyIcon data-icon="inline-start" />
                  )}
                  Clone versi
                </Button>
              ) : (
                <Button disabled={isPending || !selectedLayer} type="submit">
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
