import { describe, expect, it } from "vitest"

import {
  headerSortDirection,
  nextHeaderSort,
  sortMpqRows,
  type SortableMpqRow,
} from "@/features/mpq-sheet/sorting"

function row(
  product_size: string,
  overrides: Partial<SortableMpqRow> = {},
): SortableMpqRow {
  return {
    is_active: true,
    mpq_qty: 2000,
    product_size,
    row_no: 1,
    unit: "PCS/BOX",
    ...overrides,
  }
}

const sizes = (rows: SortableMpqRow[]) => rows.map((item) => item.product_size)

describe("sortMpqRows", () => {
  it("orders by size in both directions", () => {
    const rows = [
      row("VS-B T0.3XW100 L=120MM", { row_no: 2 }),
      row("CVO-B 10 X 11 X 105", { row_no: 1 }),
    ]

    expect(sizes(sortMpqRows(rows, "ukuran-az"))).toEqual([
      "CVO-B 10 X 11 X 105",
      "VS-B T0.3XW100 L=120MM",
    ])
    expect(sizes(sortMpqRows(rows, "ukuran-za"))).toEqual([
      "VS-B T0.3XW100 L=120MM",
      "CVO-B 10 X 11 X 105",
    ])
  })

  it("puts the largest MPQ first and the smallest last", () => {
    const rows = [
      row("Sedang", { mpq_qty: 4000, row_no: 2 }),
      row("Terkecil", { mpq_qty: 200, row_no: 3 }),
      row("Terbesar", { mpq_qty: 100000, row_no: 1 }),
    ]

    expect(sizes(sortMpqRows(rows, "mpq-terbesar"))).toEqual([
      "Terbesar",
      "Sedang",
      "Terkecil",
    ])
    expect(sizes(sortMpqRows(rows, "mpq-terkecil"))).toEqual([
      "Terkecil",
      "Sedang",
      "Terbesar",
    ])
  })

  /**
   * Ukuran nonaktif tidak dipakai jadwal baru, jadi ia dan yang aktif menjawab
   * pertanyaan berbeda. Mengelompokkannya membuat daftar yang sedang berlaku
   * terbaca sekaligus.
   */
  it("separates active sizes from deactivated ones", () => {
    const rows = [
      row("Nonaktif", { is_active: false, row_no: 2 }),
      row("Aktif", { row_no: 1 }),
    ]

    expect(sizes(sortMpqRows(rows, "status-aktif"))).toEqual([
      "Aktif",
      "Nonaktif",
    ])
    expect(sizes(sortMpqRows(rows, "status-nonaktif"))).toEqual([
      "Nonaktif",
      "Aktif",
    ])
  })

  it("groups the two units apart", () => {
    const rows = [
      row("Lakban", { row_no: 2, unit: "PCS/LAKBAN" }),
      row("Box", { row_no: 1, unit: "PCS/BOX" }),
    ]

    expect(sizes(sortMpqRows(rows, "satuan-az"))).toEqual(["Box", "Lakban"])
    expect(sizes(sortMpqRows(rows, "satuan-za"))).toEqual(["Lakban", "Box"])
  })

  /**
   * Urutan dokumen adalah jalan kembali ke daftar kertasnya, jadi ia harus
   * memulihkan nomor barisnya persis — bukan sekadar keadaan awal yang hilang
   * begitu admin menekan salah satu kolom.
   */
  it("restores the document order the paper list is read in", () => {
    const rows = [
      row("Ketiga", { row_no: 3 }),
      row("Pertama", { row_no: 1 }),
      row("Kedua", { row_no: 2 }),
    ]

    expect(sizes(sortMpqRows(rows, "urutan-dokumen"))).toEqual([
      "Pertama",
      "Kedua",
      "Ketiga",
    ])
  })

  /**
   * Puluhan ukuran berbagi MPQ 4000. Tanpa pemutus seri yang tetap, baris-baris
   * itu bertukar tempat setiap kali daftarnya dirender, dan baris yang
   * berpindah sendiri terbaca sebagai data yang berubah.
   */
  it("breaks ties by document number so the order never shuffles", () => {
    const rows = [
      row("Belakangan", { row_no: 9 }),
      row("Duluan", { row_no: 4 }),
    ]

    expect(sizes(sortMpqRows(rows, "mpq-terbesar"))).toEqual([
      "Duluan",
      "Belakangan",
    ])
    expect(sizes(sortMpqRows(rows, "satuan-az"))).toEqual([
      "Duluan",
      "Belakangan",
    ])
  })

  it("leaves the given array untouched", () => {
    const rows = [row("Kedua", { row_no: 2 }), row("Pertama", { row_no: 1 })]
    sortMpqRows(rows, "urutan-dokumen")

    expect(sizes(rows)).toEqual(["Kedua", "Pertama"])
  })
})

describe("header sorting", () => {
  it("flips between the two orders a column stands for", () => {
    expect(nextHeaderSort("ukuran", "ukuran-az")).toBe("ukuran-za")
    expect(nextHeaderSort("ukuran", "ukuran-za")).toBe("ukuran-az")
    expect(nextHeaderSort("mpq", "mpq-terkecil")).toBe("mpq-terbesar")
  })

  it("starts from the column's first order when another column is active", () => {
    expect(nextHeaderSort("mpq", "urutan-dokumen")).toBe("mpq-terkecil")
    expect(nextHeaderSort("satuan", "ukuran-az")).toBe("satuan-az")
  })

  // Panah hanya digambar di kolom yang sedang mengurutkan daftarnya.
  it("reports an arrow direction only for the active column", () => {
    expect(headerSortDirection("ukuran", "ukuran-za")).toBe("desc")
    expect(headerSortDirection("mpq", "mpq-terkecil")).toBe("asc")
    expect(headerSortDirection("mpq", "urutan-dokumen")).toBeNull()
  })
})
