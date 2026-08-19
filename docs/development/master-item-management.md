# Manajemen Master Item

`/admin/master-items` mengelola `item_code`, `part_no`, nama part, unit, dan default label Qty. Kode item dinormalisasi huruf kecil; Part No serta kode sequence dinormalisasi huruf besar. Default Qty selalu input eksplisit dan tervalidasi sebagai bilangan bulat positif.

`item_sequence_code` bersifat metadata opsional saja. Tidak ada sequence yang dialokasikan dari field ini sampai scope nomor urut disetujui pada Phase 6.

Master Item tidak dihapus. Edit ditolak hanya selama pekerjaannya masih berjalan: ada batch label box yang belum ditutup, atau ada packing session yang belum `confirmed`/`cancelled`/`expired`. Setelah batch ditutup dan verifikasinya selesai, Master Item boleh disunting — batch lama membawa salinannya sendiri (`supplier_code_snapshot`, `item_code_snapshot`, `part_no_snapshot`, `part_name_snapshot`, `packing_qty`, QR payload per box), jadi label yang sudah dibuat tetap memakai data lama sementara batch baru memakai data hasil edit. Admin masih dapat menonaktifkan record untuk menghentikan pemakaian baru sambil mempertahankan riwayat. Semua mutasi memakai RPC admin-only dengan audit log.

Nomor urut Master Item bersifat **dinamis**: posisi Master Item di dalam daftar seluruh Master Item yang diurutkan `item_code`, dihitung Postgres. Nomor itu disalin ke `label_box_batches.master_item_row_no` saat batch dibuat dan tercetak sebagai field keempat QR (`{no_urut}-{lot}-{box}`), jadi batch lama tidak ikut bergeser ketika daftar Master Item berubah. Layar membaca nomor yang sama lewat view `master_item_row_numbers`, bukan menghitungnya sendiri dengan aturan urutan yang bisa berbeda dari collation database. Konsekuensinya diterima: menambah atau menghapus Master Item menggeser nomor Master Item lain untuk batch berikutnya.

Tiga angka Qty yang mudah tertukar pada label box: **Qty/Box** (`master_items.default_label_qty`, disalin ke `label_box_batches.packing_qty`), **Packing Qty** (isian formulir, tersimpan sebagai `qty_delivery`, dibagi Qty/Box menjadi jumlah set label), dan **Qty Delivery** (isian formulir, tersimpan sebagai `qty_delivery_display`, hanya dicetak di baris Qty/Delivery label).

Part No boleh memuat spasi (`VO B 6X7`); spasi berderet dirapatkan jadi satu dan ujungnya dipangkas, di formulir admin maupun di impor CSV.

## Produk per Box dan Layer

Admin dapat membuka editor **Produk per Box dan Layer** dari baris Master Item. Pilih Box Definition milik Master Item, lalu layer bernomor yang sudah ada untuk memperbarui produk dan Qty pada layer tersebut. Editor ini hanya tersedia untuk Box Definition yang belum dipakai packing session; definisi yang sudah dipakai bersifat read-only dan menyediakan **Clone versi** sebagai recovery.

Master Item adalah editor alternatif untuk requirement produk per layer. Struktur layer tetap tersimpan pada Box Definition; semua penyimpanan memakai RPC server-side dan bukan mutasi browser langsung.
