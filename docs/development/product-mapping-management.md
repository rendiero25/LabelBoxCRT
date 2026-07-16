# Product Mapping Management

Phase 4.5 mengelola relasi many-to-many antara `master_items` dan `products` melalui `master_item_products`.

## Alur admin

1. Buka **Product Mapping** pada sidebar admin.
2. Pilih Master Item aktif dan produk aktif.
3. Simpan mapping.
4. Gunakan tabel **Pemakaian balik produk** untuk melihat Master Item yang memakai setiap produk.

## Invariant

- Satu produk dapat dipetakan ke banyak Master Item.
- Satu pasangan Master Item-produk hanya memiliki satu row database.
- Mapping aktif yang sama ditolak dengan `PRODUCT_MAPPING_EXISTS`.
- Mapping nonaktif yang dipilih kembali akan diaktifkan ulang; row historis tidak diduplikasi.
- Pembuatan mapping mensyaratkan Master Item dan produk aktif.
- Nonaktifkan mapping tidak menghapus histori. UI memberi peringatan bahwa scan baru dan konfigurasi box terkait perlu ditinjau.

## Database boundary

Mutasi hanya memakai RPC berikut:

- `create_master_item_product_mapping(p_master_item_id, p_product_id)`
- `set_master_item_product_active(p_mapping_id, p_is_active)`

Keduanya memverifikasi admin aktif, memakai `SECURITY DEFINER`, memiliki `search_path` terkunci, dan hanya dapat dieksekusi role `authenticated`. Policy direct insert/update/delete untuk `master_item_products` dihapus agar browser tidak dapat melewati RPC.

## Audit

Setiap mutation append audit log:

- `product_mapping.created`
- `product_mapping.reactivated`
- `product_mapping.activated`
- `product_mapping.deactivated`

Audit menyimpan ID pasangan serta kode Master Item, Part No, dan kode produk yang relevan.

## Error aman

| Code                                    | Pesan operator/admin                       |
| --------------------------------------- | ------------------------------------------ |
| `PRODUCT_MAPPING_EXISTS`                | Produk sudah dipetakan ke Master Item ini. |
| `PRODUCT_MAPPING_MASTER_ITEM_NOT_FOUND` | Master Item aktif tidak ditemukan.         |
| `PRODUCT_MAPPING_PRODUCT_NOT_FOUND`     | Produk aktif tidak ditemukan.              |
| `PRODUCT_MAPPING_NOT_FOUND`             | Product Mapping tidak ditemukan.           |

## Verifikasi

Jalankan test unit `src/features/product-mappings/validation.test.ts`. Setelah migration diterapkan, jalankan pgTAP `supabase/tests/database/010_phase_4_5_product_mapping.test.sql` untuk membuktikan create, duplicate prevention, deactivate, reactivate, pair uniqueness, dan audit.
