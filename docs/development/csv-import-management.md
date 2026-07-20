# CSV Import Master Data

## Status dan batasan

CSV import adalah fitur admin opsional untuk membuat data master baru. Fitur ini
tidak mengubah, menghapus, atau mengaktifkan ulang data yang sudah ada. Setiap
berkas diproses sebagai satu transaksi: satu baris tidak valid berarti tidak ada
baris dari berkas itu yang disimpan.

Box Definition tidak termasuk import CSV. Konfigurasi layer dan product
requirement harus tetap memakai CRUD sampai alurnya stabil dan dapat ditelusuri.

## Aturan berkas

- UTF-8, pemisah koma, satu baris header wajib, dan kutip CSV standar didukung.
- Maksimal 500 baris data dan 512 KB per berkas.
- Nama kolom harus persis seperti template; kolom tidak dikenal ditolak.
- Nilai dibersihkan di server. Kode yang duplikat di berkas atau database
  ditolak; import tidak melakukan upsert.
- Nomor baris pada hasil preview mengikuti nomor spreadsheet: header baris 1,
  data pertama baris 2.

## Template

### Supplier

```csv
supplier_code,supplier_name
10015,PT Supplier Contoh
```

### Product

`product_code` dibuat otomatis oleh database. Simpan kode hasil import bila
akan dipakai oleh template Product Mapping.

```csv
part_name,outer_diameter,inner_diameter,length
Tube,6,5,205
```

### Master Item

`item_sequence_code` boleh kosong.

```csv
item_code,part_no,part_name,unit,default_label_qty,item_sequence_code
dm-0001,3210A-K1Z-NA01-DL,Tube Assy,Pcs,100,
```

### Product Mapping

Kedua kode harus sudah aktif. Import file ini dijalankan setelah Product dan
Master Item tersedia.

```csv
item_code,product_code
dm-0001,prd-000001
```

### Delivery Number

Supplier harus sudah aktif. `delivery_date` memakai ISO `YYYY-MM-DD`; status
awal hanya `draft` atau `active`.

```csv
supplier_code,delivery_number,delivery_date,status
10015,DN-2026-0001,2026-07-20,active
```

## Alur wajib

1. Admin pilih template lalu unggah CSV.
2. Server parse, validasi header, batas ukuran, format tiap nilai, duplikasi,
   dan referensi database.
3. Preview menampilkan jumlah valid, jumlah error, serta error per baris.
4. Tombol import aktif hanya bila seluruh baris valid.
5. RPC database memvalidasi ulang lalu membuat seluruh data dalam satu
   transaksi.
6. Audit mencatat setiap record yang dibuat dan satu event
   `csv_import.completed` berisi template, jumlah baris, dan correlation ID.

Jika data berubah antara preview dan import, RPC membatalkan seluruh transaksi.
UI menjalankan preview ulang dan menampilkan error per baris terbaru.
