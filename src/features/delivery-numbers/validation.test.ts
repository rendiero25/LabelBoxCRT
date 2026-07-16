import { describe, expect, it } from "vitest"

import {
  parseDeliveryNumberInput,
  deliveryNumberRpcErrorMessage,
} from "@/features/delivery-numbers/validation"

describe("parseDeliveryNumberInput", () => {
  it("normalizes a delivery number and preserves its date and status", () => {
    const formData = new FormData()
    formData.set("supplierId", "00000000-0000-4000-8000-000000000001")
    formData.set("deliveryNumber", "  dev-dn-001 ")
    formData.set("deliveryDate", "2026-07-14")
    formData.set("status", "active")

    expect(parseDeliveryNumberInput(formData, { allowStatus: true })).toEqual({
      data: {
        supplierId: "00000000-0000-4000-8000-000000000001",
        deliveryNumber: "DEV-DN-001",
        deliveryDate: "2026-07-14",
        status: "active",
      },
    })
  })

  it("rejects an impossible ISO date", () => {
    const formData = new FormData()
    formData.set("supplierId", "00000000-0000-4000-8000-000000000001")
    formData.set("deliveryNumber", "DEV-DN-001")
    formData.set("deliveryDate", "2026-02-30")

    expect(parseDeliveryNumberInput(formData)).toEqual({
      error: "Tanggal delivery tidak valid.",
    })
  })
})

describe("deliveryNumberRpcErrorMessage", () => {
  it("returns a safe duplicate-number message", () => {
    expect(deliveryNumberRpcErrorMessage("DELIVERY_NUMBER_EXISTS")).toBe(
      "Delivery Number sudah digunakan untuk supplier ini.",
    )
  })
})
