import { describe, expect, it } from "vitest"

import {
  replaceLayerRequirements,
  selectableBoxDefinitions,
  selectableLayerNumbers,
  type MasterItemBoxDefinition,
} from "@/features/master-items/components/master-item-box-layer-editor"

const definitionA: MasterItemBoxDefinition = {
  id: "definition-a",
  masterItemId: "master-1",
  boxCode: "B101",
  boxName: "Box 101",
  version: 1,
  isActive: true,
  isUsed: false,
  layers: [
    {
      id: "layer-1",
      layerNo: 1,
      name: "Layer 1",
      requirements: [],
    },
    {
      id: "layer-2",
      layerNo: 2,
      name: "Layer 2",
      requirements: [],
    },
    {
      id: "layer-3",
      layerNo: 3,
      name: "Layer 3",
      requirements: [],
    },
  ],
}

const definitionB: MasterItemBoxDefinition = {
  ...definitionA,
  id: "definition-b",
  masterItemId: "master-2",
}

describe("MasterItemBoxLayerEditor state helpers", () => {
  it("selects only Box Definitions owned by the Master Item", () => {
    expect(selectableBoxDefinitions([definitionA, definitionB], "master-1")).toEqual([
      definitionA,
    ])
  })

  it("lists the existing numbered layers in a Box Definition", () => {
    expect(selectableLayerNumbers(definitionA)).toEqual([1, 2, 3])
  })

  it("replaces requirements on only the selected layer", () => {
    const layers = definitionA.layers
    const requirement = { id: "requirement-1", productId: "product-1", expectedQty: 3 }

    expect(replaceLayerRequirements(layers, "layer-2", [requirement])).toEqual([
      layers[0],
      { ...layers[1], requirements: [requirement] },
      layers[2],
    ])
  })
})
