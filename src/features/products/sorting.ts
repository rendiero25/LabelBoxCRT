/**
 * Urutan daftar produk, disebut apa adanya seperti yang dibaca admin
 * ("Terbaru", "Ukuran terbesar"), bukan sebagai pasangan kolom dan arah.
 *
 * Sebelumnya menu Urutkan hanya memuat nama kolom, dan arahnya dibalik dengan
 * menekan kolom yang sama sekali lagi — arah yang sedang berlaku cuma terbaca
 * dari panah kecil di ujung baris menu. Admin yang mencari produk terbaru harus
 * tahu lebih dulu bahwa itu berarti "tanggal dibuat, menurun".
 */
export type ProductSortKey =
  | "nama-az"
  | "nama-za"
  | "status-aktif"
  | "status-nonaktif"
  | "terbaru"
  | "terlama"
  | "ukuran-terbesar"
  | "ukuran-terkecil"

/** Yang dibutuhkan pengurutan; baris tabel boleh membawa kolom lain. */
export type SortableProduct = {
  created_at: string
  inner_diameter: number
  is_active: boolean
  length: number
  outer_diameter: number
  part_name: string
}

export const DEFAULT_PRODUCT_SORT: ProductSortKey = "nama-az"

export type ProductSortOption = {
  /** Arah untuk panah di menu dan di kepala kolom. */
  direction: "asc" | "desc"
  group: string
  key: ProductSortKey
  label: string
}

export const PRODUCT_SORT_OPTIONS: ProductSortOption[] = [
  { direction: "asc", group: "Nama", key: "nama-az", label: "Nama A–Z" },
  { direction: "desc", group: "Nama", key: "nama-za", label: "Nama Z–A" },
  {
    direction: "desc",
    group: "Ukuran",
    key: "ukuran-terbesar",
    label: "Ukuran terbesar",
  },
  {
    direction: "asc",
    group: "Ukuran",
    key: "ukuran-terkecil",
    label: "Ukuran terkecil",
  },
  { direction: "desc", group: "Dibuat", key: "terbaru", label: "Terbaru" },
  { direction: "asc", group: "Dibuat", key: "terlama", label: "Terlama" },
  {
    direction: "desc",
    group: "Status",
    key: "status-aktif",
    label: "Aktif dulu",
  },
  {
    direction: "asc",
    group: "Status",
    key: "status-nonaktif",
    label: "Nonaktif dulu",
  },
]

function byName(left: SortableProduct, right: SortableProduct): number {
  return left.part_name.localeCompare(right.part_name, "id-ID")
}

/**
 * Besar kecilnya produk dibandingkan bertingkat: diameter luar lebih dulu,
 * lalu diameter dalam, baru panjangnya. Mengalikan ketiganya jadi satu angka
 * akan menyamakan selang yang gemuk-pendek dengan yang tipis-panjang, dan itu
 * bukan yang dicari admin ketika ia meminta "ukuran terbesar".
 */
function bySize(left: SortableProduct, right: SortableProduct): number {
  return (
    left.outer_diameter - right.outer_diameter ||
    left.inner_diameter - right.inner_diameter ||
    left.length - right.length
  )
}

function byCreatedAt(left: SortableProduct, right: SortableProduct): number {
  return left.created_at.localeCompare(right.created_at)
}

/**
 * Nama dipakai sebagai pemutus seri di setiap urutan. Tanpa itu, dua produk
 * yang sama besar atau dibuat pada detik yang sama bisa bertukar tempat setiap
 * kali daftarnya dirender, dan baris yang berpindah sendiri terbaca sebagai
 * data yang berubah.
 */
const COMPARATORS: Record<
  ProductSortKey,
  (left: SortableProduct, right: SortableProduct) => number
> = {
  "nama-az": byName,
  "nama-za": (left, right) => -byName(left, right),
  "status-aktif": (left, right) =>
    Number(right.is_active) - Number(left.is_active) || byName(left, right),
  "status-nonaktif": (left, right) =>
    Number(left.is_active) - Number(right.is_active) || byName(left, right),
  terbaru: (left, right) => -byCreatedAt(left, right) || byName(left, right),
  terlama: (left, right) => byCreatedAt(left, right) || byName(left, right),
  "ukuran-terbesar": (left, right) =>
    -bySize(left, right) || byName(left, right),
  "ukuran-terkecil": (left, right) =>
    bySize(left, right) || byName(left, right),
}

export function sortProducts<T extends SortableProduct>(
  products: T[],
  key: ProductSortKey,
): T[] {
  return [...products].sort(COMPARATORS[key])
}

/**
 * Kepala kolom tetap bisa diklik dan tetap membalik urutannya; yang berubah
 * hanya namanya di menu. Satu kolom memetakan ke dua urutan bernama, dan klik
 * berikutnya berpindah ke pasangannya.
 */
export const PRODUCT_HEADER_SORTS = {
  nama: ["nama-az", "nama-za"],
  status: ["status-aktif", "status-nonaktif"],
  ukuran: ["ukuran-terkecil", "ukuran-terbesar"],
} as const satisfies Record<string, readonly [ProductSortKey, ProductSortKey]>

export type ProductSortHeader = keyof typeof PRODUCT_HEADER_SORTS

export function nextHeaderSort(
  header: ProductSortHeader,
  current: ProductSortKey,
): ProductSortKey {
  const [first, second] = PRODUCT_HEADER_SORTS[header]
  return current === first ? second : first
}

export function headerSortDirection(
  header: ProductSortHeader,
  current: ProductSortKey,
): "asc" | "desc" | null {
  const pair: readonly ProductSortKey[] = PRODUCT_HEADER_SORTS[header]
  if (!pair.includes(current)) return null

  return PRODUCT_SORT_OPTIONS.find((option) => option.key === current)!
    .direction
}
