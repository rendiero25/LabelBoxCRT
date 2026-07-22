import { describe, expect, it } from "vitest"

import { boxRpcErrorMessage, parseBoxInput } from "@/features/boxes/validation"

function validFormData(): FormData {
  const formData = new FormData()
  formData.set("boxName", " Box 101 ")
  formData.set("layers", JSON.stringify([{ name: " Layer 1 " }, { name: " Layer 2 " }]))
  return formData
}

describe("parseBoxInput", () => {
  it("normalizes box name and layer names", () => {
    expect(parseBoxInput(validFormData())).toEqual({
      data: {
        boxName: "Box 101",
        layers: [{ name: "Layer 1" }, { name: "Layer 2" }],
      },
    })
  })

  it("rejects a missing box name", () => {
    const formData = validFormData()
    formData.set("boxName", "")

    expect(parseBoxInput(formData)).toEqual({ error: "Nama box wajib diisi." })
  })

  it("rejects zero layers", () => {
    const formData = validFormData()
    formData.set("layers", "[]")

    expect(parseBoxInput(formData)).toEqual({
      error: "Minimal satu layer wajib diisi.",
    })
  })

  it("rejects an eleventh layer", () => {
    const formData = validFormData()
    formData.set(
      "layers",
      JSON.stringify(
        Array.from({ length: 11 }, (_, index) => ({ name: `Layer ${index + 1}` })),
      ),
    )

    expect(parseBoxInput(formData)).toEqual({ error: "Maksimal 10 layer per box." })
  })

  it("rejects a layer with an empty name", () => {
    const formData = validFormData()
    formData.set("layers", JSON.stringify([{ name: "" }]))

    expect(parseBoxInput(formData)).toEqual({ error: "Nama layer wajib diisi." })
  })

  it("rejects malformed layer JSON", () => {
    const formData = validFormData()
    formData.set("layers", "not-json")

    expect(parseBoxInput(formData)).toEqual({ error: "Layer box tidak valid." })
  })
})

describe("boxRpcErrorMessage", () => {
  it.each([
    ["BOX_CODE_EXISTS", "Kode box sudah digunakan."],
    ["BOX_IN_USE", "Box tidak dapat dihapus karena masih dipakai Master Item."],
    ["BOX_NOT_FOUND", "Box tidak ditemukan."],
  ])("maps %s to a safe Indonesian message", (code, message) => {
    expect(boxRpcErrorMessage(code)).toBe(message)
  })

  it("hides unexpected RPC errors", () => {
    expect(boxRpcErrorMessage("database detail")).toBe(
      "Aksi box gagal. Coba lagi atau hubungi admin.",
    )
  })
})
