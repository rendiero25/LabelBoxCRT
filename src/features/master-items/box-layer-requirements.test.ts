import { describe, expect, it } from "vitest"

import {
  masterItemBoxRpcErrorMessage,
  parseMasterItemBoxLayersInput,
} from "@/features/master-items/box-layer-requirements"

function validFormData(): FormData {
  const formData = new FormData()
  formData.set(
    "layers",
    JSON.stringify([
      {
        boxLayerId: " box-layer-id ",
        requirements: [{ productId: " product-id ", expectedQty: "3" }],
      },
    ]),
  )
  return formData
}

describe("parseMasterItemBoxLayersInput", () => {
  it("accepts and normalizes ten layers", () => {
    const formData = validFormData()
    formData.set(
      "layers",
      JSON.stringify(
        Array.from({ length: 10 }, (_, index) => ({
          boxLayerId: ` box-layer-${index + 1} `,
          requirements: [
            { productId: ` product-${index + 1} `, expectedQty: "3" },
          ],
        })),
      ),
    )

    expect(parseMasterItemBoxLayersInput(formData)).toEqual({
      data: Array.from({ length: 10 }, (_, index) => ({
        boxLayerId: `box-layer-${index + 1}`,
        requirements: [{ productId: `product-${index + 1}`, expectedQty: 3 }],
      })),
    })
  })

  it("rejects an eleventh layer", () => {
    const formData = validFormData()
    formData.set(
      "layers",
      JSON.stringify(
        Array.from({ length: 11 }, (_, index) => ({
          boxLayerId: `box-layer-${index + 1}`,
          requirements: [{ productId: `product-${index + 1}`, expectedQty: 1 }],
        })),
      ),
    )

    expect(parseMasterItemBoxLayersInput(formData)).toEqual({
      error: "Maksimal 10 layer per box.",
    })
  })

  it.each([
    ["[]", "Minimal satu layer wajib diisi."],
    ["not-json", "Layer box tidak valid."],
  ])("rejects invalid layer data", (layers, error) => {
    const formData = validFormData()
    formData.set("layers", layers)

    expect(parseMasterItemBoxLayersInput(formData)).toEqual({ error })
  })

  it.each([
    [
      [
        {
          boxLayerId: "",
          requirements: [{ productId: "product-id", expectedQty: 1 }],
        },
      ],
      "Layer box tidak valid.",
    ],
    [
      [
        {
          boxLayerId: "box-layer-1",
          requirements: [
            { productId: "product-id", expectedQty: 1 },
            { productId: "product-id", expectedQty: 2 },
          ],
        },
      ],
      "Produk requirement tidak boleh duplikat dalam satu layer.",
    ],
    [
      [
        {
          boxLayerId: "box-layer-1",
          requirements: [{ productId: "product-id", expectedQty: 0 }],
        },
      ],
      "Qty requirement harus berupa bilangan bulat lebih besar dari 0.",
    ],
    [
      [
        {
          boxLayerId: "box-layer-1",
          requirements: [{ productId: "product-id", expectedQty: [3] }],
        },
      ],
      "Qty requirement harus berupa bilangan bulat lebih besar dari 0.",
    ],
  ])("rejects an invalid layer", (layers, error) => {
    const formData = validFormData()
    formData.set("layers", JSON.stringify(layers))

    expect(parseMasterItemBoxLayersInput(formData)).toEqual({ error })
  })
})

describe("masterItemBoxRpcErrorMessage", () => {
  it.each([
    [
      "MASTER_ITEM_BOX_MISMATCH",
      "Assignment box tidak sesuai dengan Master Item ini.",
    ],
    [
      "MASTER_ITEM_BOX_IN_USE",
      "Assignment box sudah digunakan dan tidak dapat diubah.",
    ],
    [
      "MASTER_ITEM_BOX_INPUT_INVALID",
      "Data kebutuhan Box dan Layer tidak valid.",
    ],
    [
      "MASTER_ITEM_BOX_PRODUCT_NOT_ALLOWED",
      "Produk requirement tidak diizinkan untuk Master Item ini.",
    ],
    [
      "MASTER_ITEM_BOX_ADMIN_REQUIRED",
      "Aksi ini hanya tersedia untuk admin aktif.",
    ],
  ])("maps %s to a safe Indonesian message", (code, message) => {
    expect(masterItemBoxRpcErrorMessage(code)).toBe(message)
  })

  it("hides unexpected RPC errors", () => {
    expect(masterItemBoxRpcErrorMessage("database detail")).toBe(
      "Aksi kebutuhan box Master Item gagal. Coba lagi atau hubungi admin.",
    )
  })
})
