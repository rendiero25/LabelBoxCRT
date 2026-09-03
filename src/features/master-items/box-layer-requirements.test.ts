import { describe, expect, it } from "vitest"

import {
  changedLayerSelections,
  masterItemBoxRpcErrorMessage,
  parseLayerRequirementsPayload,
} from "@/features/master-items/box-layer-requirements"

describe("changedLayerSelections", () => {
  // Inti perbaikannya: menyimpan Master Item tanpa menyentuh layer tidak boleh
  // menulis ulang layer mana pun. Box yang terkunci packing session menolak
  // penulisan itu, dan penyuntingan nama gagal dengan pesan tentang Box.
  it("returns nothing when no layer was touched", () => {
    const saved = { "layer-1": ["product-a", "product-b"], "layer-2": [] }

    expect(changedLayerSelections(saved, { ...saved })).toEqual({})
  })

  it("ignores a reordered selection", () => {
    expect(
      changedLayerSelections(
        { "layer-1": ["product-a", "product-b"] },
        { "layer-1": ["product-b", "product-a"] },
      ),
    ).toEqual({})
  })

  it("returns only the layers whose products changed", () => {
    expect(
      changedLayerSelections(
        { "layer-1": ["product-a"], "layer-2": ["product-b"] },
        { "layer-1": ["product-a", "product-c"], "layer-2": ["product-b"] },
      ),
    ).toEqual({ "layer-1": ["product-a", "product-c"] })
  })

  it("treats a layer emptied by the admin as a change", () => {
    expect(
      changedLayerSelections({ "layer-1": ["product-a"] }, { "layer-1": [] }),
    ).toEqual({ "layer-1": [] })
  })

  it("treats a layer that had nothing saved as a change once it gets products", () => {
    expect(changedLayerSelections({}, { "layer-1": ["product-a"] })).toEqual({
      "layer-1": ["product-a"],
    })
  })
})

describe("parseLayerRequirementsPayload", () => {
  it("reads nothing from an empty payload", () => {
    const formData = new FormData()
    formData.set("layerRequirements", "[]")

    expect(parseLayerRequirementsPayload(formData)).toEqual({ data: [] })
  })

  it("gives every product an expected qty of one", () => {
    const formData = new FormData()
    formData.set(
      "layerRequirements",
      JSON.stringify([
        { boxLayerId: "layer-1", productIds: ["product-a", "product-a"] },
      ]),
    )

    expect(parseLayerRequirementsPayload(formData)).toEqual({
      data: [
        {
          boxLayerId: "layer-1",
          requirements: [{ productId: "product-a", expectedQty: 1 }],
        },
      ],
    })
  })

  it("keeps a layer whose products were all unchecked", () => {
    const formData = new FormData()
    formData.set(
      "layerRequirements",
      JSON.stringify([{ boxLayerId: "layer-1", productIds: [] }]),
    )

    expect(parseLayerRequirementsPayload(formData)).toEqual({
      data: [{ boxLayerId: "layer-1", requirements: [] }],
    })
  })

  it("rejects a payload that is not a list", () => {
    const formData = new FormData()
    formData.set("layerRequirements", '{"boxLayerId":"layer-1"}')

    expect(parseLayerRequirementsPayload(formData)).toEqual({
      error: "Data requirement layer tidak valid.",
    })
  })
})

describe("masterItemBoxRpcErrorMessage", () => {
  it("names the locked box in Indonesian", () => {
    expect(masterItemBoxRpcErrorMessage("MASTER_ITEM_BOX_IN_USE")).toBe(
      "Box sedang dipakai kiriman yang belum selesai. Tutup batch-nya dulu.",
    )
  })

  it("falls back to a safe message for an unknown code", () => {
    expect(masterItemBoxRpcErrorMessage("SOMETHING_ELSE")).toBe(
      "Aksi Box/Layer Master Item gagal. Coba lagi atau hubungi admin.",
    )
  })
})
