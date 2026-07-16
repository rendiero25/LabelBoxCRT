import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  requireAdmin: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("@/features/auth/server", () => ({ requireAdmin: mocks.requireAdmin }))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }))

import {
  createBoxDefinitionAction,
  updateBoxDefinitionAction,
} from "@/features/box-definitions/actions"

function validFormData(): FormData {
  const formData = new FormData()
  formData.set("masterItemId", "master-item-id")
  formData.set("boxCode", "b101")
  formData.set("boxName", " Box B101 ")
  formData.set(
    "layers",
    JSON.stringify([
      {
        name: " Layer 1 ",
        requirements: [{ productId: "product-id", expectedQty: "3" }],
      },
    ]),
  )
  return formData
}

describe("box definition actions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc })
    mocks.rpc.mockResolvedValue({ error: null })
  })

  it("prevents invalid box definitions from calling the RPC", async () => {
    const formData = validFormData()
    formData.set("layers", "[]")

    await expect(createBoxDefinitionAction({}, formData)).resolves.toEqual({
      error: "Minimal satu layer wajib diisi.",
    })

    expect(mocks.requireAdmin).toHaveBeenCalledOnce()
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it("maps a used definition RPC error to a safe action error", async () => {
    mocks.rpc.mockResolvedValueOnce({
      error: { message: "BOX_DEFINITION_IN_USE" },
    })
    const formData = validFormData()
    formData.set("boxDefinitionId", "box-definition-id")

    await expect(updateBoxDefinitionAction({}, formData)).resolves.toEqual({
      error: "Definisi box sudah digunakan dan tidak dapat diubah.",
    })

    expect(mocks.rpc).toHaveBeenCalledWith("update_box_definition", {
      p_box_definition_id: "box-definition-id",
      p_box_code: "B101",
      p_box_name: "Box B101",
      p_layers: [
        {
          name: "Layer 1",
          requirements: [{ product_id: "product-id", expected_qty: 3 }],
        },
      ],
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it("revalidates the Box Definition route after a successful create", async () => {
    await expect(createBoxDefinitionAction({}, validFormData())).resolves.toEqual(
      { success: "Definisi box dibuat." },
    )

    expect(mocks.rpc).toHaveBeenCalledWith("create_box_definition", {
      p_master_item_id: "master-item-id",
      p_box_code: "B101",
      p_box_name: "Box B101",
      p_layers: [
        {
          name: "Layer 1",
          requirements: [{ product_id: "product-id", expected_qty: 3 }],
        },
      ],
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/box-definitions")
  })
})
