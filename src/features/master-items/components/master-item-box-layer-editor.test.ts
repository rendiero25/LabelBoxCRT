import { describe, expect, it } from "vitest"

import {
  editorLayersFromBox,
  filterAssignmentsForBox,
  selectableProducts,
  type BoxOption,
  type MasterItemBoxAssignment,
  type ProductOption,
} from "@/features/master-items/components/master-item-box-layer-editor"

const boxA: BoxOption = {
  id: "box-a",
  boxCode: "B101",
  boxName: "Box 101",
  layers: [
    { id: "layer-1", layerNo: 1, name: "Layer 1" },
    { id: "layer-2", layerNo: 2, name: "Layer 2" },
  ],
}

const assignmentA1: MasterItemBoxAssignment = {
  id: "assignment-a1",
  masterItemId: "master-1",
  boxId: "box-a",
  version: 1,
  isActive: true,
  isUsed: false,
  requirementsByLayer: {
    "layer-1": [{ productId: "product-1", expectedQty: 3 }],
  },
}

const assignmentA2Draft: MasterItemBoxAssignment = {
  ...assignmentA1,
  id: "assignment-a2",
  version: 2,
  isActive: false,
}

const assignmentOtherMasterItem: MasterItemBoxAssignment = {
  ...assignmentA1,
  id: "assignment-b1",
  masterItemId: "master-2",
}

describe("filterAssignmentsForBox", () => {
  it("keeps only assignments for the given master item and box", () => {
    const assignments = [assignmentA1, assignmentA2Draft, assignmentOtherMasterItem]

    expect(filterAssignmentsForBox(assignments, "master-1", "box-a")).toEqual([
      assignmentA1,
      assignmentA2Draft,
    ])
  })

  it("sorts the active version first, then by version descending", () => {
    const assignments = [assignmentA2Draft, assignmentA1]

    const result = filterAssignmentsForBox(assignments, "master-1", "box-a")
    expect(result.map((assignment) => assignment.id)).toEqual([
      "assignment-a1",
      "assignment-a2",
    ])
  })
})

describe("editorLayersFromBox", () => {
  it("returns an empty array without a selected box", () => {
    expect(editorLayersFromBox(undefined, undefined)).toEqual([])
  })

  it("builds one editor row per box layer, sorted by layer number", () => {
    const layers = editorLayersFromBox(boxA, undefined)

    expect(layers.map((layer) => layer.layerNo)).toEqual([1, 2])
    expect(layers.map((layer) => layer.name)).toEqual(["Layer 1", "Layer 2"])
  })

  it("defaults to one empty requirement row for a layer with none saved", () => {
    const layers = editorLayersFromBox(boxA, undefined)
    const layerTwo = layers.find((layer) => layer.boxLayerId === "layer-2")

    expect(layerTwo?.requirements).toHaveLength(1)
    expect(layerTwo?.requirements[0]).toMatchObject({ productId: "", expectedQty: 1 })
  })

  it("hydrates existing requirements from the assignment", () => {
    const layers = editorLayersFromBox(boxA, assignmentA1)
    const layerOne = layers.find((layer) => layer.boxLayerId === "layer-1")

    expect(layerOne?.requirements).toHaveLength(1)
    expect(layerOne?.requirements[0]).toMatchObject({
      productId: "product-1",
      expectedQty: 3,
    })
  })
})

describe("selectableProducts", () => {
  const products: ProductOption[] = [
    {
      id: "product-1",
      productCode: "prd-1",
      partName: "Tube",
      outerDiameter: null,
      innerDiameter: null,
      length: null,
      normalizedDimensions: null,
    },
    {
      id: "product-2",
      productCode: "prd-2",
      partName: "Tube",
      outerDiameter: null,
      innerDiameter: null,
      length: null,
      normalizedDimensions: null,
    },
  ]

  it("excludes products already picked by another requirement in the layer", () => {
    const requirements = [
      { id: "req-1", productId: "product-1", expectedQty: 1 },
      { id: "req-2", productId: "product-2", expectedQty: 1 },
    ]

    expect(selectableProducts(products, requirements, "req-2").map((p) => p.id)).toEqual([
      "product-2",
    ])
  })

  it("keeps a product available to the requirement currently holding it", () => {
    const requirements = [{ id: "req-1", productId: "product-1", expectedQty: 1 }]

    expect(selectableProducts(products, requirements, "req-1").map((p) => p.id)).toEqual([
      "product-1",
      "product-2",
    ])
  })
})
