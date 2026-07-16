# Manajemen Produk

Produk memakai schema migration yang berlaku: `product_code`, `part_name`, `outer_diameter`, `inner_diameter`, dan `length`. UI memperlihatkan preview key `ODxIDxLength`, sama dengan kolom generated `normalized_dimensions` di PostgreSQL. Ini menggantikan asumsi lama satu field `size` pada `flowsystem.md`.

Kode produk dinormalisasi ke huruf kecil dan unik secara case-insensitive. Produk tidak dihapus dari UI; admin menonaktifkannya agar data master dan riwayat scan tetap utuh. Edit ditolak bila produk telah memiliki accepted scan. Setiap mutasi lewat RPC teraudit dan memverifikasi admin aktif.
