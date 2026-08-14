import { describe, expect, it } from "vitest"

import {
  headerSortDirection,
  nextHeaderSort,
  sortProducts,
  type SortableProduct,
} from "@/features/products/sorting"

function product(
  part_name: string,
  overrides: Partial<SortableProduct> = {},
): SortableProduct {
  return {
    created_at: "2026-01-01T00:00:00Z",
    inner_diameter: 5,
    is_active: true,
    length: 100,
    outer_diameter: 6,
    part_name,
    ...overrides,
  }
}

const names = (products: SortableProduct[]) =>
  products.map((item) => item.part_name)

describe("sortProducts", () => {
  it("orders by name in both directions", () => {
    const products = [product("Selang C"), product("Selang A")]

    expect(names(sortProducts(products, "nama-az"))).toEqual([
      "Selang A",
      "Selang C",
    ])
    expect(names(sortProducts(products, "nama-za"))).toEqual([
      "Selang C",
      "Selang A",
    ])
  })

  it("puts the newest product first and the oldest last", () => {
    const products = [
      product("Lama", { created_at: "2025-03-04T00:00:00Z" }),
      product("Baru", { created_at: "2026-08-14T00:00:00Z" }),
    ]

    expect(names(sortProducts(products, "terbaru"))).toEqual(["Baru", "Lama"])
    expect(names(sortProducts(products, "terlama"))).toEqual(["Lama", "Baru"])
  })

  /**
   * Ukuran dibandingkan bertingkat, bukan sebagai hasil kali: selang gemuk
   * pendek dan selang tipis panjang bisa punya hasil kali yang sama, dan
   * menyamakan keduanya bukan yang dicari admin.
   */
  it("ranks size by outer diameter, then inner, then length", () => {
    const products = [
      product("Tipis panjang", {
        inner_diameter: 3,
        length: 400,
        outer_diameter: 4,
      }),
      product("Gemuk pendek", {
        inner_diameter: 9,
        length: 50,
        outer_diameter: 12,
      }),
      product("Sedang", { inner_diameter: 5, length: 200, outer_diameter: 6 }),
    ]

    expect(names(sortProducts(products, "ukuran-terbesar"))).toEqual([
      "Gemuk pendek",
      "Sedang",
      "Tipis panjang",
    ])
    expect(names(sortProducts(products, "ukuran-terkecil"))).toEqual([
      "Tipis panjang",
      "Sedang",
      "Gemuk pendek",
    ])
  })

  it("separates active from inactive products", () => {
    const products = [
      product("Nonaktif", { is_active: false }),
      product("Aktif"),
    ]

    expect(names(sortProducts(products, "status-aktif"))).toEqual([
      "Aktif",
      "Nonaktif",
    ])
    expect(names(sortProducts(products, "status-nonaktif"))).toEqual([
      "Nonaktif",
      "Aktif",
    ])
  })

  /**
   * Seri diputus nama supaya urutannya tetap sama setiap kali daftar dirender;
   * baris yang berpindah sendiri terbaca sebagai data yang berubah.
   */
  it("breaks ties by name so the order never shuffles", () => {
    const products = [product("Selang C"), product("Selang A")]

    expect(names(sortProducts(products, "terbaru"))).toEqual([
      "Selang A",
      "Selang C",
    ])
    expect(names(sortProducts(products, "ukuran-terbesar"))).toEqual([
      "Selang A",
      "Selang C",
    ])
  })

  it("leaves the given array untouched", () => {
    const products = [product("Selang C"), product("Selang A")]
    sortProducts(products, "nama-az")

    expect(names(products)).toEqual(["Selang C", "Selang A"])
  })
})

describe("header sorting", () => {
  it("flips between the two orders a column stands for", () => {
    expect(nextHeaderSort("nama", "nama-az")).toBe("nama-za")
    expect(nextHeaderSort("nama", "nama-za")).toBe("nama-az")
    expect(nextHeaderSort("ukuran", "ukuran-terkecil")).toBe("ukuran-terbesar")
  })

  it("starts from the column's first order when another column is active", () => {
    expect(nextHeaderSort("ukuran", "terbaru")).toBe("ukuran-terkecil")
    expect(nextHeaderSort("status", "nama-az")).toBe("status-aktif")
  })

  // Panah hanya digambar di kolom yang sedang mengurutkan daftarnya.
  it("reports an arrow direction only for the active column", () => {
    expect(headerSortDirection("nama", "nama-za")).toBe("desc")
    expect(headerSortDirection("ukuran", "ukuran-terkecil")).toBe("asc")
    expect(headerSortDirection("ukuran", "terbaru")).toBeNull()
  })
})
