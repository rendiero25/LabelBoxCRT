# Manajemen Master Item

`/admin/master-items` mengelola `item_code`, `part_no`, nama part, unit, dan default label Qty. Kode item dinormalisasi huruf kecil; Part No serta kode sequence dinormalisasi huruf besar. Default Qty selalu input eksplisit dan tervalidasi sebagai bilangan bulat positif.

`item_sequence_code` bersifat metadata opsional saja. Tidak ada sequence yang dialokasikan dari field ini sampai scope nomor urut disetujui pada Phase 6.

Master Item tidak dihapus. Edit ditolak setelah ada packing session; admin masih dapat menonaktifkan record untuk menghentikan pemakaian baru sambil mempertahankan riwayat. Semua mutasi memakai RPC admin-only dengan audit log.

## Produk per Box dan Layer

Admin dapat membuka editor **Produk per Box dan Layer** dari baris Master Item. Pilih Box Definition milik Master Item, lalu layer bernomor yang sudah ada untuk memperbarui produk dan Qty pada layer tersebut. Editor ini hanya tersedia untuk Box Definition yang belum dipakai packing session; definisi yang sudah dipakai bersifat read-only dan menyediakan **Clone versi** sebagai recovery.

Master Item adalah editor alternatif untuk requirement produk per layer. Struktur layer tetap tersimpan pada Box Definition; semua penyimpanan memakai RPC server-side dan bukan mutasi browser langsung.
