# Verification Product Coverage — Design

**Goal:** Panel kanan layar Verifikasi menampilkan produk yang diminta box batch beserta status scan-nya, dan batch tidak boleh ditutup sebelum semua produk itu pernah discan.

**Status:** disetujui 2026-07-30. Lanjutan dari `2026-07-29-label-box-verification-and-print-design.md`.

---

## Keputusan yang dikunci

- Form Tambah label box **tidak berubah**. Lot Number tetap, tidak ada scan di sana
- Daftar produk diambil dari `box_layer_requirements` milik box batch, **bukan** dari `master_item_products`. Produk yang terpetakan ke Master Item tetapi tidak diminta layer box mana pun akan selalu ditolak `accept_packing_scan`, jadi memakainya sebagai syarat akan mengunci batch selamanya
- Aturan ditegakkan di RPC, bukan hanya tombol. Tombol saja bisa dilewati dengan memanggil RPC langsung
- Panel "Scan terakhir" diganti, bukan ditambah. Umpan balik scan tetap ada di blok tengah dan toast

## Aturan

Batch boleh ditutup hanya bila setiap produk yang diminta box batch punya minimal satu `packing_session_scans` dengan `result = 'accepted'` pada sesi milik batch itu. Kalau belum, `close_label_box_batch` melempar `MASTER_ITEM_PRODUCTS_INCOMPLETE`.

Jumlah scan per produk tidak diperiksa — cukup pernah sekali. Box yang belum penuh tetap boleh dicetak, sesuai keputusan sebelumnya.

## Data

Produk yang diminta batch:

```
label_boxes (batch_id) -> box_id
  -> box_layers (box_id)
    -> box_layer_requirements (box_layer_id) -> product_id
      -> products: product_code, part_name, outer_diameter, inner_diameter, length
```

Produk yang sudah tercakup:

```
label_boxes (batch_id) -> packing_session_id
  -> packing_session_scans where result = 'accepted' -> distinct product_id
```

`packing_session_scans.product_id` sudah ada, jadi tidak perlu kolom baru.

## RPC

`close_label_box_batch` menambah satu penjaga sebelum menstempel `closed_at`, setelah pemeriksaan `LABEL_BOX_BATCH_ALREADY_CLOSED`:

- kumpulkan `product_id` yang diminta box batch
- kumpulkan `product_id` yang punya scan diterima di batch
- ada selisih → `MASTER_ITEM_PRODUCTS_INCOMPLETE`

Tidak ada kolom atau tabel baru.

## UI

`label-box-verification-console.tsx`, panel `aside` kanan:

- Judul "Produk Master Item"
- Tiap baris: kode produk dan nama, ukuran `OD × ID × Length`, ikon centang bila sudah discan atau silang bila belum
- Tombol **Selesaikan verifikasi** nonaktif selama masih ada yang belum discan, dengan keterangan sisa berapa produk

Halaman `verifikasi/page.tsx` memuat kedua kumpulan data di atas dan menurunkannya sebagai prop.

## Error

`MASTER_ITEM_PRODUCTS_INCOMPLETE` → "Masih ada produk Master Item yang belum discan." di `verification-actions.ts`.

## Testing

pgTAP `020` kini hanya punya satu produk sehingga aturan ini tidak teruji. Tambah produk kedua yang diminta layer box kedua, lalu uji:

- tutup ditolak dengan `MASTER_ITEM_PRODUCTS_INCOMPLETE` saat baru satu produk discan
- tutup berhasil setelah kedua produk discan

Hitungan `plan` menyesuaikan.
