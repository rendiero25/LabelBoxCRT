/**
 * Urutan daftar MPQ Sheet, disebut apa adanya seperti yang dibaca admin
 * ("MPQ terbesar", "Urutan dokumen"), mengikuti menu Urutkan di halaman Produk.
 *
 * Urutan dokumen dipertahankan sebagai pilihan tersendiri, bukan sekadar
 * keadaan awal: daftar ini menyalin satu dokumen kertas, dan admin yang sedang
 * mencocokkan layar dengan dokumennya perlu jalan kembali ke urutan itu setelah
 * mengurutkan menurut kolom lain.
 */
export type MpqSortKey =
  | "mpq-terbesar"
  | "mpq-terkecil"
  | "satuan-az"
  | "satuan-za"
  | "status-aktif"
  | "status-nonaktif"
  | "ukuran-az"
  | "ukuran-za"
  | "urutan-dokumen"

/** Yang dibutuhkan pengurutan; baris tabel boleh membawa kolom lain. */
export type SortableMpqRow = {
  is_active: boolean
  mpq_qty: number
  product_size: string
  row_no: number
  unit: string
}

export const DEFAULT_MPQ_SORT: MpqSortKey = "urutan-dokumen"

export type MpqSortOption = {
  /** Arah untuk panah di menu dan di kepala kolom. */
  direction: "asc" | "desc"
  group: string
  key: MpqSortKey
  label: string
}

export const MPQ_SORT_OPTIONS: MpqSortOption[] = [
  {
    direction: "asc",
    group: "Dokumen",
    key: "urutan-dokumen",
    label: "Urutan dokumen",
  },
  { direction: "asc", group: "Ukuran", key: "ukuran-az", label: "Ukuran A–Z" },
  { direction: "desc", group: "Ukuran", key: "ukuran-za", label: "Ukuran Z–A" },
  {
    direction: "desc",
    group: "MPQ",
    key: "mpq-terbesar",
    label: "MPQ terbesar",
  },
  {
    direction: "asc",
    group: "MPQ",
    key: "mpq-terkecil",
    label: "MPQ terkecil",
  },
  { direction: "asc", group: "Satuan", key: "satuan-az", label: "Satuan A–Z" },
  { direction: "desc", group: "Satuan", key: "satuan-za", label: "Satuan Z–A" },
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

function bySize(left: SortableMpqRow, right: SortableMpqRow): number {
  return left.product_size.localeCompare(right.product_size, "id-ID")
}

function byUnit(left: SortableMpqRow, right: SortableMpqRow): number {
  return left.unit.localeCompare(right.unit, "id-ID")
}

function byRowNo(left: SortableMpqRow, right: SortableMpqRow): number {
  return left.row_no - right.row_no
}

/**
 * Nomor dokumen jadi pemutus seri di setiap urutan. Banyak ukuran berbagi MPQ
 * yang sama persis — 4000 saja dipakai puluhan baris — dan tanpa pemutus yang
 * tetap, baris-baris itu bisa bertukar tempat setiap kali daftarnya dirender.
 * Baris yang berpindah sendiri terbaca sebagai data yang berubah.
 */
const COMPARATORS: Record<
  MpqSortKey,
  (left: SortableMpqRow, right: SortableMpqRow) => number
> = {
  "mpq-terbesar": (left, right) =>
    right.mpq_qty - left.mpq_qty || byRowNo(left, right),
  "mpq-terkecil": (left, right) =>
    left.mpq_qty - right.mpq_qty || byRowNo(left, right),
  "satuan-az": (left, right) => byUnit(left, right) || byRowNo(left, right),
  "satuan-za": (left, right) => -byUnit(left, right) || byRowNo(left, right),
  "status-aktif": (left, right) =>
    Number(right.is_active) - Number(left.is_active) || byRowNo(left, right),
  "status-nonaktif": (left, right) =>
    Number(left.is_active) - Number(right.is_active) || byRowNo(left, right),
  "ukuran-az": (left, right) => bySize(left, right) || byRowNo(left, right),
  "ukuran-za": (left, right) => -bySize(left, right) || byRowNo(left, right),
  "urutan-dokumen": byRowNo,
}

export function sortMpqRows<T extends SortableMpqRow>(
  rows: T[],
  key: MpqSortKey,
): T[] {
  return [...rows].sort(COMPARATORS[key])
}

/**
 * Kepala kolom tetap bisa diklik dan tetap membalik urutannya; satu kolom
 * memetakan ke dua urutan bernama, dan klik berikutnya berpindah ke
 * pasangannya. Kolom No tidak ikut: yang tampil di sana nomor baris layar,
 * bukan nomor dokumen, jadi mengurutkannya tidak berarti apa-apa.
 */
export const MPQ_HEADER_SORTS = {
  mpq: ["mpq-terkecil", "mpq-terbesar"],
  satuan: ["satuan-az", "satuan-za"],
  status: ["status-aktif", "status-nonaktif"],
  ukuran: ["ukuran-az", "ukuran-za"],
} as const satisfies Record<string, readonly [MpqSortKey, MpqSortKey]>

export type MpqSortHeader = keyof typeof MPQ_HEADER_SORTS

export function nextHeaderSort(
  header: MpqSortHeader,
  current: MpqSortKey,
): MpqSortKey {
  const [first, second] = MPQ_HEADER_SORTS[header]
  return current === first ? second : first
}

export function headerSortDirection(
  header: MpqSortHeader,
  current: MpqSortKey,
): "asc" | "desc" | null {
  const pair: readonly MpqSortKey[] = MPQ_HEADER_SORTS[header]
  if (!pair.includes(current)) return null

  return MPQ_SORT_OPTIONS.find((option) => option.key === current)!.direction
}
