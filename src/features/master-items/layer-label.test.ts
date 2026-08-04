import { describe, expect, it } from "vitest"

import { shortenLayerName } from "@/features/master-items/layer-label"

describe("shortenLayerName", () => {
  // Bentuk yang benar-benar tersimpan di database pada Master Item nyata.
  it("drops the repeated layer number from the generated name", () => {
    expect(shortenLayerName("Box 1 - Layer 1")).toBe("Box 1")
    expect(shortenLayerName("Box 3 - Layer 2")).toBe("Box 3")
  })

  it("accepts the separators an operator might type", () => {
    expect(shortenLayerName("Box 2 – Layer 3")).toBe("Box 2")
    expect(shortenLayerName("Box 2 · Layer 3")).toBe("Box 2")
    expect(shortenLayerName("Box 2 Layer 3")).toBe("Box 2")
  })

  it("leaves a name that carries no layer suffix alone", () => {
    expect(shortenLayerName("Rak bawah")).toBe("Rak bawah")
    expect(shortenLayerName("  Rak atas  ")).toBe("Rak atas")
  })

  it("keeps the original when nothing would be left", () => {
    expect(shortenLayerName("Layer 2")).toBe("Layer 2")
  })
})
