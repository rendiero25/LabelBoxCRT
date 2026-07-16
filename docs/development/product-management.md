# Manajemen Produk

Produk memakai schema migration yang berlaku: `product_code`, `part_name`, `outer_diameter`, `inner_diameter`, dan `length`. Saat membuat produk baru, kode dibuat otomatis oleh database dengan format `prd-000001`. UI memperlihatkan ukuran label sebagai `Nama Part DODXID Pt.L=Length`, misalnya `VO-B D6X7 Pt.L=525`; key generated `normalized_dimensions` di PostgreSQL tetap `ODxIDxLength` untuk pencarian dan validasi. Ini menggantikan asumsi lama satu field `size` pada `flowsystem.md`.

Kode produk dinormalisasi ke huruf kecil dan unik secara case-insensitive. Produk tidak dihapus dari UI; admin menonaktifkannya agar data master dan riwayat scan tetap utuh. Edit ditolak bila produk telah memiliki accepted scan. Setiap mutasi lewat RPC teraudit dan memverifikasi admin aktif.
