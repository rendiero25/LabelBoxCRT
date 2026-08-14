import { describe, expect, it } from "vitest"

import { isFirstLabelOfBatch, parseBoxNumber } from "@/lib/label/box-number"

describe("parseBoxNumber", () => {
  it("reads the box number before the two-digit set number", () => {
    expect(parseBoxNumber("B101")).toEqual({ boxNo: 1, setNo: 1 })
    expect(parseBoxNumber("B203")).toEqual({ boxNo: 2, setNo: 3 })
    expect(parseBoxNumber("B1299")).toEqual({ boxNo: 12, setNo: 99 })
  })

  it("returns null for anything that is not a box number", () => {
    expect(parseBoxNumber("")).toBeNull()
    expect(parseBoxNumber("101")).toBeNull()
    expect(parseBoxNumber("BOX-1")).toBeNull()
  })
})

/**
 * Cetak ulang hanya memuat box yang dipilih operator, jadi label pertama tidak
 * bisa ditentukan dari urutan daftarnya: mencetak ulang B301 sendirian akan
 * membuat box ketiga membawa QR milik batch.
 */
describe("isFirstLabelOfBatch", () => {
  it("marks only box 1 of set 1", () => {
    expect(isFirstLabelOfBatch("B101")).toBe(true)
    expect(isFirstLabelOfBatch("B201")).toBe(false)
    expect(isFirstLabelOfBatch("B301")).toBe(false)
    expect(isFirstLabelOfBatch("B102")).toBe(false)
  })

  it("treats an unreadable box number as not the first label", () => {
    expect(isFirstLabelOfBatch("B1")).toBe(false)
    expect(isFirstLabelOfBatch("kosong")).toBe(false)
  })
})
