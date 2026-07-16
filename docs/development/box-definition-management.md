# Manajemen Box Definition

## Tujuan

Halaman `/admin/box-definitions` dipakai admin untuk membentuk versi definisi box: Master Item, kode dan nama box, urutan layer, serta kebutuhan produk dan quantity pada setiap layer. Semua perubahan diproses melalui RPC admin; browser tidak menulis tabel box secara langsung.

## Membuat draft

1. Pilih Master Item aktif.
2. Isi kode dan nama box.
3. Tambah, hapus, atau pindahkan layer dengan tombol **Naik** dan **Turun**. Urutan yang tersimpan selalu mengikuti urutan yang terlihat di editor.
4. Pada setiap layer, pilih produk yang memiliki mapping aktif ke Master Item tersebut, lalu masukkan Qty integer minimal 1.
5. Periksa subtotal layer dan total seluruh box, kemudian pilih **Buat draft**.

Produk yang sudah dipilih dalam layer yang sama tidak muncul lagi sebagai pilihan requirement lain pada layer tersebut. Produk yang tidak memiliki mapping aktif tidak dapat dipilih.

Contoh B101:

- Layer 1: Tube × 3
- Layer 2: Tube × 5
- Total box: 8 unit

## Edit, publish, dan clone

Draft dapat diedit untuk memperbarui kode/nama box, layer, produk, serta quantity. Pilih **Publikasikan** lalu konfirmasi untuk mengaktifkan versi tersebut. Database melakukan validasi akhir sebelum publish, termasuk kelengkapan layer dan requirement.

Jika definisi sudah memiliki packing session, status **Dipakai** akan muncul. Versi tersebut hanya dapat dilihat agar data packing historis tidak berubah. Pilih **Clone versi**, konfirmasi, lalu sistem membuat versi berikutnya sebagai draft dengan urutan layer dan requirement yang sama. Edit draft hasil clone dan publish saat siap.

## Aturan integritas

- Qty requirement harus integer 1 sampai 1.000.000.
- Setiap layer harus memiliki nama dan minimal satu requirement produk.
- Publish, create, update, dan clone memerlukan admin aktif.
- Pesan error aman ditampilkan lewat Sonner; detail internal database tidak ditampilkan di UI.
