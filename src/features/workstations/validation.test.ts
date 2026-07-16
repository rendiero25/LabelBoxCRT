import { describe, expect, it } from "vitest"

import {
  parseDisableReason,
  parseEnrollmentCode,
  parseRegisterWorkstationInput,
} from "@/features/workstations/validation"

describe("parseRegisterWorkstationInput", () => {
  it("normalizes a workstation code and preserves mapped hardware fields", () => {
    const formData = new FormData()
    formData.set("workstationCode", " line-a_01 ")
    formData.set("name", " Line A ")
    formData.set("printerName", " ZDesigner ZD220 ")
    formData.set("printerModel", " Zebra ZD220 ")
    formData.set("scannerModel", " Zebra DS2208 2D ")
    formData.set("operatorId", "00000000-0000-0000-0000-000000000001")

    expect(parseRegisterWorkstationInput(formData)).toEqual({
      data: {
        workstationCode: "LINE-A_01",
        name: "Line A",
        printerName: "ZDesigner ZD220",
        printerModel: "Zebra ZD220",
        scannerModel: "Zebra DS2208 2D",
        operatorId: "00000000-0000-0000-0000-000000000001",
      },
    })
  })

  it("rejects unsafe workstation code", () => {
    const formData = new FormData()
    formData.set("workstationCode", "line a 01")

    expect(parseRegisterWorkstationInput(formData)).toEqual({
      error:
        "Kode workstation harus 2–64 karakter A–Z, angka, garis bawah, atau tanda minus.",
    })
  })
})

describe("workstation enrollment inputs", () => {
  it("accepts only a full one-time enrollment code", () => {
    const formData = new FormData()
    formData.set("enrollmentCode", "a".repeat(64))
    expect(parseEnrollmentCode(formData)).toEqual({
      data: { enrollmentCode: "a".repeat(64) },
    })
  })

  it("requires a reason when disabling a workstation", () => {
    const formData = new FormData()
    formData.set("workstationId", "workstation-id")
    expect(parseDisableReason(formData)).toEqual({
      error: "Alasan menonaktifkan workstation wajib diisi.",
    })
  })
})
