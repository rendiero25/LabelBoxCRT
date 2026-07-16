# Master Item: Produk per Box dan Layer

## Tujuan

Admin mengelola requirement produk dari konteks Master Item melalui Box Definition yang sudah ada. Alur layar adalah: pilih box milik Master Item, pilih atau susun layer 1 sampai 10, lalu pilih produk dan quantity pada setiap layer.

## Keputusan desain

- Relasi database tetap normal: `master_items` → `box_definitions` → `box_layers` → `box_layer_requirements` → `products`.
- Tidak ada field `box_layer_id` pada tabel `products`. Satu produk dapat dipakai oleh lebih dari satu Master Item, Box Definition, atau layer.
- `master_item_products` tetap menjadi daftar produk yang diizinkan untuk Master Item. Saat admin menyimpan requirement baru dari layar Master Item, mapping yang belum ada dibuat atau diaktifkan kembali oleh server sebelum requirement disimpan.
- Box Definition tetap wajib memiliki satu Master Item. Master Item dibuat terlebih dahulu; setelah itu admin membuat atau memilih Box Definition miliknya.
- Definisi yang sudah dipakai packing session tetap tidak dapat diedit. Admin harus clone versi baru, lalu mengubah requirement pada draft hasil clone.

## Perilaku UI

Halaman Master Item mendapat aksi **Atur produk per Box & Layer** pada setiap baris.

1. Dialog menampilkan pilihan Box Definition milik Master Item tersebut saja.
2. Setelah box dipilih, dialog menampilkan layer 1–10 dan requirement produk yang sudah tersimpan.
3. Admin dapat menambah, menghapus, dan mengurutkan produk requirement pada setiap layer; setiap requirement memiliki Produk dan Qty positif.
4. Pilihan produk mengambil Produk aktif. Produk yang sudah ada pada requirement layer lain tetap dapat dipilih bila memang diperlukan pada layer tersebut.
5. Simpan menampilkan toast sukses/gagal dan revalidasi halaman Master Item serta Box Definition.
6. Jika belum ada Box Definition, UI mengarahkan admin membuat Box Definition untuk Master Item tersebut.

## Aturan server dan database

- Layer per Box Definition harus berjumlah minimum 1 dan maksimum 10.
- Server memverifikasi admin aktif, Master Item aktif, Box Definition milik Master Item, Produk aktif, dan Qty positif.
- Penyimpanan dilakukan dalam satu RPC: lock Box Definition, validasi payload, buat/aktifkan mapping `master_item_products` yang diperlukan, ganti requirement layer, append audit, lalu selesai atomik.
- Tidak ada direct DML baru dari browser. RPC sensitif memakai authorization yang sama dengan admin master data saat ini dan execute untuk `authenticated` saja.
- Error domain dipetakan ke pesan admin yang aman; tidak mengirim error database mentah ke UI.

## Dampak terhadap layar Box Definition

- Editor Box Definition tetap tersedia untuk membuat box dan struktur layer.
- Validasi maksimal 10 layer berlaku juga pada editor Box Definition agar kedua layar konsisten.
- Requirement yang dikelola dari Master Item adalah sumber data yang sama, bukan salinan kedua.

## Pengujian

- Unit: batas 1–10 layer, payload produk/Qty, dan pesan error.
- Database/RPC: admin dapat menyimpan requirement dan mapping otomatis terbentuk; non-admin ditolak; box lintas Master Item ditolak; Produk nonaktif ditolak; 11 layer ditolak; Box Definition terpakai ditolak; audit tercatat.
- UI: pilihan box difilter ke Master Item, layer dan requirement termuat, toast muncul setelah simpan.

