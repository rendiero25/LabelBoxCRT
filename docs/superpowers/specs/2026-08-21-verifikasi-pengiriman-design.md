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

Tabel dua kolom: **Ukuran Produk** dan **Qty per Box**. Nilainya datang dari
upload Excel atau PDF.

Kolom pertama semula dikira Part No Master Item. Ternyata ukuran produk —
`VS-B T0.3XW100 L=120MM` — jadi label kolomnya dan nama kolom databasenya
(`product_size`) mengikuti arti itu. Header di file tetap bertulis "Part no";
parser mengenalinya dari nama, bukan dari artinya.

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

Scan QR label box. Baris jadwal menyebut ukuran produk sedangkan label
menyebut Master Item, jadi ada satu langkah terjemahan di antaranya:

**ukuran produk → produk → Master Item**, lewat `master_item_products`.

Ukuran diurai dengan satu aturan untuk semua bentuk penulisan: tiga angka
pertama diambil berurutan, dan nama part dicocokkan sebagai awalan teksnya.

```
'VO-B D6X7 Pt.L=525'      ->  VO-B  +  6 x 7 x 525      (tabung)
'VS-B T0.3XW100 L=120MM'  ->  VS-B  +  0.3 x 100 x 120  (pelat)
```

Angka dibandingkan sebagai angka, bukan teks, supaya `0.3` dan `0.30` sama —
dokumen jadwal diketik tangan.

Baris PASS kalau Master Item hasil terjemahan sama dengan Master Item label
yang discan **dan** Qty per Box jadwal sama dengan `qty_delivery_display` milik
batch — angka yang di label tercetak di baris QTY/DELIVERY.

Ukuran yang tidak menunjuk produk mana pun tetap boleh diunggah; barisnya
ditandai "Ukuran tidak dikenal" di layar sejak upload, jauh sebelum truknya
diperiksa.

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

pgTAP: `030` (session + jadwal, termasuk ukuran kembar dengan Qty berbeda),
`031` (terjemahan ukuran dua bentuk penulisan, `0.30` = `0.3`, PASS,
`duplicate_label`, `unknown_label`, dan bahwa yang dibandingkan Packing Qty
5000 — bukan Qty/Box 100 maupun Qty Delivery 200), `032` (hapus session,
cascade, ringkasan audit).

Ketiganya mengembalikan `delivery_verification_session_seq` di akhir file:
`nextval()` tidak ikut rollback, dan tanpa pengembalian itu nomor session nyata
berikutnya melompat.

Vitest: parser Excel (bentuk dokumen asli, variasi ejaan header, variasi
penulisan Qty) dan komponen workspace (kartu tidak melipat diri saat scan
terakhirnya menutup session; kegagalan tak terduga tetap memunculkan toast).

## Keadaan

Bagian 1 dan Bagian 2 sudah jalan. Yang belum:

- **Upload PDF** — menunggu contoh dokumen asli.
- **Produk belum terdaftar** — dua belas ukuran di dokumen jadwal yang ada
  (`VS-B T0.3XW…`) tidak menunjuk satu pun baris `products`, jadi barisnya
  muncul sebagai "Ukuran tidak dikenal" dan tidak akan pernah PASS sampai
  produk-produk itu didaftarkan dan dipetakan ke Master Item.
- **Part No ber-`=` ditolak Master Item** — `create_master_item` memakai
  `^[A-Z0-9][A-Z0-9 _./-]{1,127}$`, yang tidak mengizinkan `=`. Kalau ukuran
  seperti `L=120MM` perlu jadi Part No Master Item, aturan itu harus dilonggarkan
  lewat migrasi tersendiri.
