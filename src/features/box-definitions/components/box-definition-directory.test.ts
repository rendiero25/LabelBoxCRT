import { describe, expect, it } from "vitest"

import {
  addEditorLayer,
  addEditorRequirement,
  createInitialEditorLayers,
  editorGrandTotal,
  moveEditorLayer,
  removeEditorLayer,
  selectableProductsForRequirement,
  type BoxDefinitionEditorLayer,
} from "@/features/box-definitions/components/box-definition-directory"

const products = [
  {
    id: "product-tube",
    productCode: "TUBE",
    partName: "Tube",
    normalizedDimensions: "D5.5 x D6.3 x L205",
  },
  {
    id: "product-cap",
    productCode: "CAP",
    partName: "Cap",
    normalizedDimensions: null,
  },
]

describe("box definition editor state", () => {
  it("starts with one editable layer and keeps layer order contiguous", () => {
    const initial = createInitialEditorLayers()
    const withSecondLayer = addEditorLayer(initial)
    const moved = moveEditorLayer(withSecondLayer, 1, -1)
    const remaining = removeEditorLayer(moved, 1)

    expect(initial).toHaveLength(1)
    expect(withSecondLayer.map((layer) => layer.name)).toEqual([
      "Layer 1",
      "Layer 2",
    ])
    expect(moved.map((layer) => layer.name)).toEqual(["Layer 2", "Layer 1"])
    expect(remaining.map((layer) => layer.name)).toEqual(["Layer 2"])
  })

  it("adds requirements and calculates layer and grand quantity totals", () => {
    const layers: BoxDefinitionEditorLayer[] = [
      {
        id: "layer-1",
        name: "Layer 1",
        requirements: [{ id: "requirement-1", productId: "product-tube", expectedQty: 3 }],
      },
      {
        id: "layer-2",
        name: "Layer 2",
        requirements: [{ id: "requirement-2", productId: "product-tube", expectedQty: 5 }],
      },
    ]

    const updated = addEditorRequirement(layers, 0)

    expect(updated[0].requirements).toHaveLength(2)
    expect(editorGrandTotal(layers)).toBe(8)
  })

  it("only offers mapped products that are not already selected in the same layer", () => {
    expect(
      selectableProductsForRequirement(
        products,
        [{ id: "requirement-1", productId: "product-tube", expectedQty: 3 }],
        "requirement-2",
      ),
    ).toEqual([products[1]])
  })
})
