import { describe, expect, it } from "vitest"

import {
  masterItemBoxRequirementsRpcErrorMessage,
  parseMasterItemBoxRequirementsInput,
} from "@/features/master-items/box-layer-requirements"

function validFormData(): FormData {
  const formData = new FormData()
  formData.set("boxDefinitionId", " box-definition-id ")
  formData.set(
    "layers",
    JSON.stringify([
      {
        name: " Layer 1 ",
        requirements: [{ productId: " product-id ", expectedQty: "3" }],
      },
    ]),
  )
  return formData
}

describe("parseMasterItemBoxRequirementsInput", () => {
  it("accepts and normalizes ten layers", () => {
    const formData = validFormData()
    formData.set(
      "layers",
      JSON.stringify(
        Array.from({ length: 10 }, (_, index) => ({
          name: ` Layer ${index + 1} `,
          requirements: [
            { productId: ` product-${index + 1} `, expectedQty: "3" },
          ],
        })),
      ),
    )

    expect(parseMasterItemBoxRequirementsInput(formData)).toEqual({
      data: {
        boxDefinitionId: "box-definition-id",
        layers: Array.from({ length: 10 }, (_, index) => ({
          name: `Layer ${index + 1}`,
          requirements: [{ productId: `product-${index + 1}`, expectedQty: 3 }],
        })),
      },
    })
  })

  it("rejects an eleventh layer", () => {
    const formData = validFormData()
    formData.set(
      "layers",
      JSON.stringify(
        Array.from({ length: 11 }, (_, index) => ({
          name: `Layer ${index + 1}`,
          requirements: [{ productId: `product-${index + 1}`, expectedQty: 1 }],
        })),
      ),
    )

    expect(parseMasterItemBoxRequirementsInput(formData)).toEqual({
      error: "Maksimal 10 layer per box.",
    })
  })

  it.each([["boxDefinitionId", "", "Box Definition wajib dipilih."]])(
    "rejects an empty %s",
    (field, value, error) => {
      const formData = validFormData()
      formData.set(field, value)

      expect(parseMasterItemBoxRequirementsInput(formData)).toEqual({ error })
    },
  )

  it.each([
    ["[]", "Minimal satu layer wajib diisi."],
    ["not-json", "Layer box tidak valid."],
  ])("rejects invalid layer data", (layers, error) => {
    const formData = validFormData()
    formData.set("layers", layers)

    expect(parseMasterItemBoxRequirementsInput(formData)).toEqual({ error })
  })

  it.each([
    [
      [
        {
          name: "",
          requirements: [{ productId: "product-id", expectedQty: 1 }],
        },
      ],
      "Nama layer wajib diisi.",
    ],
    [
      [
        {
          name: "Layer 1",
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
          name: "Layer 1",
          requirements: [{ productId: "product-id", expectedQty: 0 }],
        },
      ],
      "Qty requirement harus berupa bilangan bulat lebih besar dari 0.",
    ],
    [
      [
        {
          name: "Layer 1",
          requirements: [{ productId: "product-id", expectedQty: [3] }],
        },
      ],
      "Qty requirement harus berupa bilangan bulat lebih besar dari 0.",
    ],
  ])("rejects an invalid layer", (layers, error) => {
    const formData = validFormData()
    formData.set("layers", JSON.stringify(layers))

    expect(parseMasterItemBoxRequirementsInput(formData)).toEqual({ error })
  })
})

describe("masterItemBoxRequirementsRpcErrorMessage", () => {
  it("maps a mismatched box definition to a safe Indonesian message", () => {
    expect(
      masterItemBoxRequirementsRpcErrorMessage(
        "MASTER_ITEM_BOX_DEFINITION_MISMATCH",
      ),
    ).toBe("Box Definition tidak sesuai dengan Master Item ini.")
  })

  it("hides unexpected RPC errors", () => {
    expect(masterItemBoxRequirementsRpcErrorMessage("database detail")).toBe(
      "Aksi kebutuhan box Master Item gagal. Coba lagi atau hubungi admin.",
    )
  })
})
