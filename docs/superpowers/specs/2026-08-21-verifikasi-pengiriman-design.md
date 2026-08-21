# Verifikasi Pengiriman — Desain

Halaman `/verifikasi-pengiriman`. Operator membuat **session**, mengisi
**Schedule Delivery** dari file, lalu memverifikasi tiap label box dengan scan
QR. Session selesai ketika seluruh baris jadwal sudah tercocokkan.

## Session

Tombol **Tambah Session** langsung membuat session tanpa isian: nomor urut dan
tanggal buat. Kolom lain di tabel session diisi data turunan — jumlah baris
jadwal, berapa yang sudah PASS, Part No pertama — supaya operator tahu ini
session apa tanpa membukanya.

## Bagian 1 — Schedule Delivery

Tabel dua kolom: **Part No** (Part No Master Item) dan **Qty** (Packing Qty).
Nilainya datang dari upload Excel atau PDF.

Satu file boleh memuat satu baris maupun banyak; parser membaca semua yang ada
lalu menambahkannya ke bawah tabel. Upload berikutnya menambah lagi, tidak
menimpa. Part No yang sudah ada **jadi baris sendiri** — dua kiriman Part No
sama dengan Qty berbeda adalah dua baris, dan masing-masing perlu satu label
yang cocok.

Kontrak parser Excel: baris header dicari lebih dulu, kolom Part No dan Qty
dikenali dari namanya — tidak peka besar-kecil huruf, toleran spasi dan variasi
("Part Number", "Qty Delivery"). Baris tanpa Part No dilewati.

Excel dikerjakan lebih dulu memakai `exceljs` yang sudah terpasang. PDF
menyusul: `pdfkit` di project ini hanya bisa menulis PDF, jadi membacanya perlu
pustaka baru, dan PDF tidak menyimpan tabel — hanya potongan teks berkoordinat,
sehingga parsernya harus diikat ke tata letak dokumen yang sebenarnya.

**Terbuka:** kontrak di atas masih asumsi sampai contoh file aslinya ada.

## Bagian 2 — Verifikasi Label

Scan QR label box. Yang dicocokkan: Part No Master Item dan Packing Qty —
angka yang di label tercetak di baris QTY/DELIVERY.

**Isi string QR tidak dipercaya.** Tiga generasi QR beredar, dan dua di
antaranya berbentuk sama persis (lima field) tetapi field ketiganya berbeda
arti: label sebelum migrasi `20260821083835` membawa Qty/Box, sesudahnya
membawa Packing Qty. Dari bentuknya saja keduanya tidak bisa dibedakan, jadi
parser string apa pun akan salah pada sebagian label.

Karena itu RPC mencari `qr_payload` di `label_boxes`, naik ke batch-nya, lalu
memakai `part_no_snapshot` dan `qty_delivery_display` dari database. String QR
cuma kunci pencarian, bukan sumber angka. Satu jalur ini benar untuk ketiga
generasi label sekaligus.

| Keadaan | Toast | Tabel |
|---|---|---|
| Cocok baris yang belum PASS | **PASS** | centang hijau di baris itu |
| Label ada, tidak ada baris cocok | **NOT PASS** | tidak berubah |
| Payload tidak ada di `label_boxes` | **NOT PASS** — label tidak dikenal | tidak berubah |
| Baris terakhir baru saja PASS | **DELIVERY OK** | session jadi `done` |

Scan dobel pada label yang sama tidak menghasilkan PASS kedua: barisnya sudah
terisi, jadi jatuh ke NOT PASS. Satu label fisik hanya boleh memenuhi satu
baris jadwal.

## Tabel

```
delivery_verification_sessions
  id, session_no, status (open|done), created_by, created_at, closed_at

delivery_schedule_rows
  id, session_id, row_no, part_no, qty, source_file_name, created_at,
  verified_at, verified_label_box_id        -- null selama belum PASS

delivery_verification_scans                 -- menyusul bersama Bagian 2
  id, session_id, scanned_at, scanned_by, qr_payload,
  result (pass|not_pass|unknown_label), matched_row_id
```

Tabel scan membuat NOT PASS bisa ditelusuri. Tanpanya, scan yang gagal hilang
tanpa jejak dan tidak ada yang tahu label mana yang salah masuk truk.

Semua tulis lewat RPC `security definer`; RLS hanya memberi baca ke pengguna
aktif, sama seperti tabel label box.

## Pengujian

pgTAP untuk tiap RPC — termasuk Part No kembar dengan Qty berbeda, scan dobel,
dan label generasi lama yang harus tetap cocok lewat lookup. Vitest untuk
parser Excel dan pemetaan hasil RPC ke toast.

## Urutan

Bagian 1 sampai jalan penuh lebih dulu, Bagian 2 sebagai langkah terpisah.
