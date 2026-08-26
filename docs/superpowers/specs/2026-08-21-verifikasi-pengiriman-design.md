# Verifikasi Pengiriman — Desain

Halaman `/verifikasi-pengiriman`. Operator membuat **session**, mengisi
**Schedule Delivery** dari file, lalu memverifikasi tiap label box dengan scan
QR. Session selesai ketika seluruh baris jadwal sudah tercocokkan.

## Session

Tombol **Tambah Session** langsung membuat session tanpa isian: nomor urut dan
tanggal buat. Sisanya diturunkan dari baris jadwalnya — jumlah baris, berapa
yang sudah PASS, berapa ukuran yang tak dikenal — supaya operator tahu ini
session apa tanpa membukanya.

Kartu session bisa dilipat. Yang sudah `done` terlipat sendiri, yang masih
`open` terbuka. Bawaan itu dipatok sekali saat sessionnya pertama terlihat,
bukan dihitung ulang dari status yang sedang berjalan: scan terakhir yang
melunasi sebuah session mengubah statusnya jadi `done` di RPC yang sama, dan
menghitung ulang berarti kartunya menutup diri sendiri tepat saat operator baru
melihat hasilnya. Melipat sekaligus mematikan pendengar scan — scan yang masuk
ke jadwal yang tidak terlihat tidak bisa diperiksa siapa pun.

Session bisa dihapus. Baris jadwal dan catatan scannya ikut lewat cascade —
itu seluruh bukti pemeriksaan satu kiriman — jadi RPC-nya menulis ringkasannya
ke `audit_logs` lebih dulu: nomor session, jumlah baris, berapa yang PASS,
berapa kali discan.

## Bagian 1 — Schedule Delivery

Tabel dua kolom: **Part No** dan **Qty per Box**. Nilainya datang dari upload
Excel atau PDF.

Kolom pertama adalah Part No label sheet, yang isinya memang ukuran —
`VS-B T0.3XW100 L=120MM`. Nama kolom databasenya `product_size`, peninggalan
tahap ketika ia dikira penunjuk ke produk; isinya Part No, dan yang berlaku
adalah cara ia dipakai.

Kolom kedua tersimpan sebagai `qty` dan dicocokkan dengan
`qty_delivery_display` milik batch. "Qty per Box" adalah nama yang dipakai
operator untuk angka itu — baris QTY/DELIVERY pada label fisik, bukan baris
Qty/Box yang nilainya sama untuk setiap kiriman Master Item itu.

Satu file boleh memuat satu baris maupun banyak; parser membaca semua yang ada
lalu menambahkannya ke bawah tabel. Upload berikutnya menambah lagi, tidak
menimpa. Ukuran yang sudah ada **jadi baris sendiri** — dua kiriman ukuran
sama dengan Qty berbeda adalah dua baris, dan masing-masing perlu satu label
yang cocok.

Kontrak parser Excel: baris header dicari lebih dulu (kop dokumen dilewati),
kolom ukuran dan Qty dikenali dari namanya — tidak peka besar-kecil huruf,
toleran spasi dan variasi ("Part Number", "Qty Delivery", "Jumlah"). Baris
tanpa ukuran dilewati; baris yang punya ukuran tetapi Qty-nya tidak terbaca
menggagalkan seluruh file, sebab melewatinya berarti satu kiriman hilang dari
jadwal tanpa ada yang tahu.

Kontrak itu sudah dicocokkan ke dokumen jadwal yang sebenarnya (header
`No | Part no | Qty`, ukuran berspasi ekor) dan bentuk itu dikunci sebagai tes;
datanya diganti supaya data kiriman asli tidak ikut masuk repo.

Excel dikerjakan lebih dulu memakai `exceljs` yang sudah terpasang. PDF
ditolak dengan pesannya sendiri dan **belum dikerjakan**: `pdfkit` di project
ini hanya bisa menulis PDF, jadi membacanya perlu pustaka baru, dan PDF tidak
menyimpan tabel — hanya potongan teks berkoordinat, sehingga parsernya harus
diikat ke tata letak dokumen yang sebenarnya.

**Terbuka:** contoh PDF asli belum ada.

## Bagian 2 — Verifikasi Label

Scan QR label box sheet. Perbandingannya **langsung**, tanpa terjemahan:

| Jadwal | Label |
|---|---|
| Part No (kolom pertama file) | `part_no_snapshot` |
| Qty per Box | `qty_delivery_display` |

Baris PASS kalau kedua-duanya cocok.

Isi file jadwal berdiri sendiri — tidak perlu didaftarkan sebagai produk
maupun master data lebih dulu. Rancangan sebelumnya menerjemahkan ukuran lewat
`products` dan `master_item_products`; itu dibuang beserta kedua fungsi
pembantunya, sebab kolom pertama file ternyata Part No label sheet itu sendiri,
bukan penunjuk ke produk lain.

Kedua sisi dirapikan dengan cara yang sama sebelum dibandingkan — huruf besar,
spasi beruntun jadi satu, ujung dipangkas. Dokumen jadwal diketik tangan dan
Part No di master data tidak selalu ditulis dengan spasi yang sama.

Karena Part No sheet memuat `=` (`VS-B T0.3XW100 L=120MM`), aturan Part No
Master Item dilonggarkan menerima karakter itu (migrasi `20260826071627`).
Tanpa itu Master Item untuk sheet tidak bisa didaftarkan sama sekali, dan
labelnya tidak pernah ada.

Baris yang belum punya label — belum ada batch mana pun membawa Part No dan Qty
per Box itu — ditandai "Belum ada" di kolom Label sejak upload. Itu keadaan
sekarang, bukan vonis: labelnya masih bisa dicetak menyusul lalu PASS.

**Isi string QR tidak dipercaya.** Tiga generasi QR beredar, dan dua di
antaranya berbentuk sama persis (lima field) tetapi field ketiganya berbeda
arti: label sebelum migrasi `20260821083835` membawa Qty/Box, sesudahnya
membawa Packing Qty. Dari bentuknya saja keduanya tidak bisa dibedakan, jadi
parser string apa pun akan salah pada sebagian label.

Karena itu RPC mencari `qr_payload` di `label_boxes`, naik ke batch-nya, lalu
memakai `part_no_snapshot` dan `qty_delivery_display` dari database. String QR
cuma kunci pencarian, bukan sumber angka. Satu jalur ini benar untuk ketiga
generasi label sekaligus.

| Keadaan | `result` | Toast | Tabel |
|---|---|---|---|
| Cocok baris yang belum PASS | `pass` | **PASS** | centang hijau di baris itu |
| Label ada, tidak ada baris cocok | `not_pass` | **NOT PASS** | tidak berubah |
| Label sudah dipakai baris lain di session ini | `duplicate_label` | **NOT PASS** — sudah dipakai | tidak berubah |
| Payload tidak ada di `label_boxes` | `unknown_label` | **NOT PASS** — label tidak dikenal | tidak berubah |
| Baris terakhir baru saja PASS | `pass` | **DELIVERY OK** menyusul PASS-nya | session jadi `done` |

Satu label fisik hanya boleh memenuhi satu baris jadwal, jadi scan dobel jatuh
ke `duplicate_label` — bukan dicocokkan lagi ke baris berikutnya yang kebetulan
sama.

DELIVERY OK berdiri sendiri sesudah toast PASS-nya, bukan menggantikannya:
label terakhir tetap perlu terlihat diterima.

Selama scan aktif, kartu sessionnya bercincin, ada titik berdenyut di sebelah
tombolnya, dan hasil scan terakhir bertahan di layar. Toast bisa terlewat waktu
operator sedang menempel label; ketiganya masih terbaca begitu ia menoleh.

Kegagalan panggilan itu sendiri — koneksi putus, server action basi setelah
kode diubah — ditangkap terpisah dari NOT PASS dan tetap memunculkan toast.
Tanpa itu ia membisu, dan operator tidak bisa membedakannya dari scan yang
tidak terbaca sama sekali.

## Tabel

```
delivery_verification_sessions
  id, session_no, status (open|done), created_by, created_at, closed_at

delivery_schedule_rows
  id, session_id, row_no, product_size, qty, source_file_name, created_at,
  verified_at, verified_label_box_id        -- null selama belum PASS

delivery_verification_scans
  id, session_id, scanned_at, scanned_by, qr_payload, label_box_id,
  result (pass|not_pass|unknown_label|duplicate_label), matched_row_id
```

Tabel scan membuat NOT PASS bisa ditelusuri. Tanpanya, scan yang gagal hilang
tanpa jejak dan tidak ada yang tahu label mana yang salah masuk truk.

Semua tulis lewat RPC `security definer`; RLS hanya memberi baca ke pengguna
aktif, sama seperti tabel label box.

## Pengujian

pgTAP: `030` (session + jadwal, termasuk Part No kembar dengan Qty berbeda),
`031` (Part No ber-`=` diterima sedangkan karakter di luar daftar tetap
ditolak; PASS; ejaan berspasi ganda dan huruf kecil di jadwal tetap cocok;
`duplicate_label`; `unknown_label`; Qty sama dengan Part No berbeda tidak
cukup untuk PASS; dan bahwa yang dibandingkan Qty per Box 5000 — bukan Qty/Box
100 maupun Qty Delivery 200), `032` (hapus session, cascade, ringkasan audit).

Ketiganya mengembalikan `delivery_verification_session_seq` di akhir file:
`nextval()` tidak ikut rollback, dan tanpa pengembalian itu nomor session nyata
berikutnya melompat.

Vitest: parser Excel (bentuk dokumen asli, variasi ejaan header, variasi
penulisan Qty) dan komponen workspace (kartu tidak melipat diri saat scan
terakhirnya menutup session; kegagalan tak terduga tetap memunculkan toast).

## Keadaan

Bagian 1 dan Bagian 2 sudah jalan. Yang belum:

- **Upload PDF** — menunggu contoh dokumen asli.
- **Master Item sheet belum didaftarkan** — dua belas Part No di dokumen jadwal
  yang ada (`VS-B T0.3XW…`) belum punya Master Item, jadi belum ada labelnya dan
  barisnya muncul sebagai "Belum ada" di kolom Label. Setelah Master Item dan
  boxnya dibuat lalu batch labelnya dicetak, barisnya PASS tanpa perubahan kode
  — dibuktikan ujung ke ujung terhadap jadwal yang benar-benar diunggah, di
  transaksi yang di-rollback.
