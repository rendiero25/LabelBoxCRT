# Manajemen Master Item

`/admin/master-items` mengelola `item_code`, `part_no`, nama part, unit, dan default label Qty. Kode item dinormalisasi huruf kecil; Part No serta kode sequence dinormalisasi huruf besar. Default Qty selalu input eksplisit dan tervalidasi sebagai bilangan bulat positif.

`item_sequence_code` bersifat metadata opsional saja. Tidak ada sequence yang dialokasikan dari field ini sampai scope nomor urut disetujui pada Phase 6.

Master Item tidak dihapus. Edit ditolak setelah ada packing session; admin masih dapat menonaktifkan record untuk menghentikan pemakaian baru sambil mempertahankan riwayat. Semua mutasi memakai RPC admin-only dengan audit log.
