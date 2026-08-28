import { describe, expect, it } from "vitest"

import {
  mpqRpcErrorMessage,
  parseMpqInput,
} from "@/features/mpq-sheet/validation"

function formData(fields: Record<string, string>): FormData {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

describe("parseMpqInput", () => {
  /**
   * Dibakukan persis seperti di RPC-nya. Kalau keduanya berbeda pendapat,
   * admin melihat satu bentuk di form dan bentuk lain tersimpan.
   */
  it("stores the size upper-cased with runs of spaces collapsed", () => {
    const parsed = parseMpqInput(
      formData({
        mpqQty: "2000",
        productSize: "  vs-b   t0.3xw100   L=195MM ",
        unit: " pcs/box ",
      }),
    )

    expect("data" in parsed && parsed.data).toEqual({
      mpqQty: 2000,
      productSize: "VS-B T0.3XW100 L=195MM",
      unit: "PCS/BOX",
    })
  })

  it.each([
    ["", "ukuran kosong"],
    ["   ", "ukuran spasi belaka"],
  ])("rejects %s", (productSize) => {
    const parsed = parseMpqInput(
      formData({ mpqQty: "2000", productSize, unit: "PCS/BOX" }),
    )

    expect("error" in parsed && parsed.error).toContain("Ukuran wajib diisi")
  })

  /**
   * Setengah keping tidak punya arti di lapangan, dan membulatkannya diam-diam
   * mengubah angka yang dipakai menghitung jumlah box.
   */
  it.each(["2000.5", "2,000", "dua ribu", ""])(
    "rejects the quantity %s",
    (mpqQty) => {
      const parsed = parseMpqInput(
        formData({ mpqQty, productSize: "UJI T1XW1 L=1MM", unit: "PCS/BOX" }),
      )

      expect("error" in parsed).toBe(true)
    },
  )

  it("rejects a quantity of zero", () => {
    const parsed = parseMpqInput(
      formData({
        mpqQty: "0",
        productSize: "UJI T1XW1 L=1MM",
        unit: "PCS/BOX",
      }),
    )

    expect("error" in parsed && parsed.error).toContain("lebih dari nol")
  })

  // Pagar terhadap salah ketik, bukan aturan bisnis: MPQ tertinggi yang
  // sungguh dipakai 10.000, dan 20000000 hampir pasti kelebihan nol.
  it("rejects a quantity far past anything real", () => {
    const parsed = parseMpqInput(
      formData({
        mpqQty: "20000000",
        productSize: "UJI T1XW1 L=1MM",
        unit: "PCS/BOX",
      }),
    )

    expect("error" in parsed && parsed.error).toContain("terlalu besar")
  })

  it("requires a unit", () => {
    const parsed = parseMpqInput(
      formData({ mpqQty: "2000", productSize: "UJI T1XW1 L=1MM", unit: " " }),
    )

    expect("error" in parsed && parsed.error).toContain("Unit/Box wajib diisi")
  })
})

describe("mpqRpcErrorMessage", () => {
  /**
   * Ukuran kembar adalah kesalahan yang paling mungkin membingungkan: admin
   * mengetik ejaan berspasi berbeda dan mengira itu ukuran baru, jadi pesannya
   * harus menyebut bahwa spasi tidak membedakan.
   */
  it("explains that spacing does not make a different size", () => {
    expect(mpqRpcErrorMessage("MPQ_SIZE_EXISTS")).toContain(
      "Spasi tidak membedakan",
    )
  })

  // Galat Postgres mentah tidak boleh sampai ke layar operator.
  it("falls back to a safe sentence for anything unmapped", () => {
    expect(
      mpqRpcErrorMessage('duplicate key value violates unique constraint "x"'),
    ).toBe("Aksi MPQ gagal. Coba lagi atau hubungi admin.")
  })
})
