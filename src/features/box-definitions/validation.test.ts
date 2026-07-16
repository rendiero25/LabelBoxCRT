import { describe, expect, it } from "vitest"

import {
  boxDefinitionRpcErrorMessage,
  parseBoxDefinitionInput,
} from "@/features/box-definitions/validation"

function validFormData(): FormData {
  const formData = new FormData()
  formData.set("masterItemId", " master-item-id ")
  formData.set("boxCode", " b101 ")
  formData.set("boxName", " Box B101 ")
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

describe("parseBoxDefinitionInput", () => {
  it("normalizes nested input and converts expected quantity strings", () => {
    expect(parseBoxDefinitionInput(validFormData())).toEqual({
      data: {
        masterItemId: "master-item-id",
        boxCode: "B101",
        boxName: "Box B101",
        layers: [
          {
            name: "Layer 1",
            requirements: [{ productId: "product-id", expectedQty: 3 }],
          },
        ],
      },
    })
  })

  it("rejects a zero expected quantity", () => {
    const formData = validFormData()
    formData.set(
      "layers",
      JSON.stringify([
        {
          name: "Layer 1",
          requirements: [{ productId: "product-id", expectedQty: "0" }],
        },
      ]),
    )

    expect(parseBoxDefinitionInput(formData)).toEqual({
      error: "Qty requirement harus berupa bilangan bulat lebih besar dari 0.",
    })
  })

  it.each([
    ["masterItemId", "", "Master Item wajib dipilih."],
    ["boxCode", "", "Kode box wajib diisi."],
    ["boxName", "", "Nama box wajib diisi."],
  ])("rejects an empty %s", (field, value, error) => {
    const formData = validFormData()
    formData.set(field, value)

    expect(parseBoxDefinitionInput(formData)).toEqual({ error })
  })

  it("rejects malformed layers JSON without throwing", () => {
    const formData = validFormData()
    formData.set("layers", "not-json")

    expect(parseBoxDefinitionInput(formData)).toEqual({
      error: "Layer box tidak valid.",
    })
  })

  it("rejects box definitions without layers", () => {
    const formData = validFormData()
    formData.set("layers", "[]")

    expect(parseBoxDefinitionInput(formData)).toEqual({
      error: "Minimal satu layer wajib diisi.",
    })
  })

  it.each([
    [
      [{ name: "", requirements: [{ productId: "product-id", expectedQty: 1 }] }],
      "Nama layer wajib diisi.",
    ],
    [[{ name: "Layer 1", requirements: [] }], "Minimal satu requirement wajib diisi."],
    [
      [{ name: "Layer 1", requirements: [{ productId: "", expectedQty: 1 }] }],
      "Produk requirement wajib dipilih.",
    ],
  ])("rejects an invalid layer requirement", (layers, error) => {
    const formData = validFormData()
    formData.set("layers", JSON.stringify(layers))

    expect(parseBoxDefinitionInput(formData)).toEqual({ error })
  })

  it.each(["1.5", "1000001", "abc"]) (
    "rejects an invalid expected quantity of %s",
    (expectedQty) => {
      const formData = validFormData()
      formData.set(
        "layers",
        JSON.stringify([
          {
            name: "Layer 1",
            requirements: [{ productId: "product-id", expectedQty }],
          },
        ]),
      )

      expect(parseBoxDefinitionInput(formData)).toEqual({
        error: "Qty requirement harus berupa bilangan bulat lebih besar dari 0.",
      })
    },
  )

  it.each([
    ["boxCode", "a".repeat(65), "Kode box maksimal 64 karakter."],
    ["boxName", "a".repeat(201), "Nama box maksimal 200 karakter."],
  ])("rejects an overlong %s", (field, value, error) => {
    const formData = validFormData()
    formData.set(field, value)

    expect(parseBoxDefinitionInput(formData)).toEqual({ error })
  })
})

describe("boxDefinitionRpcErrorMessage", () => {
  it.each([
    ["BOX_DEFINITION_ADMIN_REQUIRED", "Aksi ini hanya tersedia untuk admin aktif."],
    ["BOX_DEFINITION_INPUT_INVALID", "Data definisi box tidak valid."],
    ["BOX_DEFINITION_IN_USE", "Definisi box sudah digunakan dan tidak dapat diubah."],
    ["BOX_DEFINITION_NOT_FOUND", "Definisi box tidak ditemukan."],
    ["BOX_DEFINITION_VERSION_EXISTS", "Versi definisi box sudah ada."],
    ["BOX_DEFINITION_INVALID", "Definisi box belum valid untuk diaktifkan."],
    [
      "BOX_DEFINITION_PRODUCT_NOT_ALLOWED",
      "Produk requirement tidak diizinkan untuk Master Item ini.",
    ],
  ])("maps %s to a safe Indonesian message", (code, expectedMessage) => {
    expect(boxDefinitionRpcErrorMessage(code)).toBe(expectedMessage)
  })

  it("hides unexpected RPC errors", () => {
    expect(boxDefinitionRpcErrorMessage("database detail")).toBe(
      "Aksi definisi box gagal. Coba lagi atau hubungi admin.",
    )
  })
})
