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

Kolom pertama adalah ukuran produk seperti tertulis di label —
`VS-B T0.3XW100 L=120MM`. Nama kolom databasenya `product_size`.

Kolom kedua tersimpan sebagai `qty` dan dicocokkan dengan Qty delivery yang
tercetak di label. "Qty per Box" adalah nama yang dipakai operator untuk angka
itu — baris QTY/DELIVERY pada label fisik, bukan baris Qty/Box yang nilainya
sama untuk setiap kiriman Master Item itu.

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

Scan QR label box sheet. Yang dibandingkan diambil dari **string QR-nya
sendiri**, dipecah pada `|`:

```
10015|VS-B T0.3XW100 L=120MM|2000|DBT-512 NI-2445-240826-B001|24-AUG-2026
       ^ field 2: ukuran produk        ^ field 3: Qty delivery
```

| Jadwal      | Payload |
| ----------- | ------- |
| Part No     | field 2 |
| Qty per Box | field 3 |

Baris PASS kalau kedua-duanya cocok. Field lain — kode supplier, lot, tanggal —
tidak dibaca sama sekali: tidak ada yang meminta keduanya diperiksa, dan setiap
field tambahan yang dibaca adalah satu cara baru sebuah scan gagal.

Label sheet **tidak dibuat aplikasi ini** dan tidak perlu dibuat. Rancangan
sebelumnya mencari `qr_payload` di `label_boxes` lalu naik ke batch-nya; itu
dibuang (migrasi `20260827094500`). Label sheet sudah tercetak di lantai
produksi, jadi payload-nya tidak pernah ada di tabel itu dan setiap scan
berakhir `unknown_label` — tidak satu pun baris jadwal bisa PASS sebelum Master
Item sheet didaftarkan dan batch-nya dicetak, padahal yang diperiksa cuma dua
angka yang sudah tercetak di dalam QR-nya.

Isi file jadwal karena itu berdiri sendiri di kedua sisi: tidak ada produk,
Master Item, maupun batch yang perlu ada lebih dulu.

**Spasi diabaikan sepenuhnya** di kedua sisi, dan huruf disamakan jadi besar
(migrasi `20260827103000`). Dokumen jadwal diketik tangan: pada jadwal yang
benar-benar diunggah, sebelas baris menulis `L=180MM` rapat sementara satu baris
menulis `L=110 MM` berspasi. Aturan sebelumnya hanya memampatkan spasi beruntun
jadi satu, jadi baris itu tidak akan pernah PASS — dan gagalnya baru ketahuan
setelah seluruh truk diperiksa.

Harga yang dibayar: dua ukuran yang hanya dibedakan letak spasinya terbaca sama.
Untuk kode ukuran seperti ini spasi adalah pemisah baca, bukan pembawa makna,
sementara kegagalan yang dicegah nyata dan sudah terjadi.

Yang tersimpan dan yang tampil di layar tidak ikut berubah: baris jadwal tetap
memakai ejaan dokumennya sendiri, supaya isi tabel masih bisa ditelusuri kembali
ke file asalnya. Yang dilonggarkan hanya perbandingannya.

| Keadaan                                                    | `result`        | Toast                             | Tabel                      |
| ---------------------------------------------------------- | --------------- | --------------------------------- | -------------------------- |
| Cocok baris yang belum PASS                                | `pass`          | **PASS**                          | centang hijau di baris itu |
| QR terbaca, tidak ada baris cocok                          | `not_pass`      | **NOT PASS**                      | tidak berubah              |
| Kurang dari 3 field, atau Qty bukan bilangan bulat positif | `unknown_label` | **NOT PASS** — QR tidak terbaca   | tidak berubah              |
| Baris terakhir baru saja PASS                              | `pass`          | **DELIVERY OK** menyusul PASS-nya | session jadi `done`        |

`unknown_label` dibedakan dari `not_pass` karena keduanya menuntut tindakan
berbeda: yang satu berarti QR-nya tidak terbaca, yang lain berarti QR terbaca
tetapi barangnya bukan yang dijadwalkan.

**Scan dobel tidak dicek.** `duplicate_label` bertumpu pada identitas label
fisik di `label_boxes`, dan identitas itu sudah tidak ada; field keempat payload
memang berbeda antar label, tetapi memakainya berarti memutuskan diam-diam
bahwa penulisannya konsisten, dan itu belum diperiksa. Konsekuensinya diterima
sadar: satu box yang discan dua kali melunasi dua baris berukuran sama, dan
session bisa tutup dengan satu box kurang di truk. `delivery_verification_scans`
tetap mencatat tiap scan beserta payload mentahnya, jadi kejadian itu masih bisa
ditelusuri sesudahnya.

## Bagaimana scan sampai ke halaman

Dua jalur sekaligus: **kotak scan** yang terfokus sendiri begitu mode scan
menyala, dan pendengar global untuk ketikan yang mendarat di badan halaman.
Pendengar global mengabaikan input, jadi satu tembakan tidak pernah terkirim
dua kali.

Kotak scan mengirim **setelah ketikan diam 180 ms**, bukan menunggu Enter. Itu
bukan kenyamanan melainkan syarat: DS2208 di lantai produksi tidak dipasangi
sufiks apa pun — bukan Enter, bukan Tab. Diperiksa dengan menembak ke sebuah
textarea, payloadnya datang utuh 73 karakter tanpa `\n`, dan fokus tidak
berpindah.

Sebelum kotak scan ada, halaman ini hanya mengirim saat Enter. Dengan scanner
tanpa sufiks itu berarti buffernya menumpuk selamanya: tidak ada payload
tampil, tidak ada server action terpanggil, tidak ada satu pun pesan. Diam
total — jenis kegagalan paling mahal, karena tidak meninggalkan apa pun untuk
dibaca. Halaman verifikasi packing sudah memakai pola yang sama sejak lama,
dan itulah sebabnya ia tetap jalan sementara halaman ini mati.

Ditambah pula penanda **"Halaman tidak fokus"**: scanner mengetik ke jendela
yang sedang fokus, jadi keadaan itu harus terlihat, bukan disimpulkan dari
kesunyian.

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
  verified_at, verified_label_box_id        -- selalu null; label_boxes tak dipakai

delivery_verification_scans
  id, session_id, scanned_at, scanned_by, qr_payload, label_box_id,
  result (pass|not_pass|unknown_label|duplicate_label), matched_row_id
```

`verified_label_box_id` dan `label_box_id` tinggal sebagai kolom kosong, dan
`duplicate_label` sebagai nilai enum yang tidak pernah dihasilkan lagi.
Keduanya dibiarkan: membuangnya tidak menambah apa pun, sementara catatan scan
lama masih menunjuk ke label yang pernah ada.

Tabel scan membuat NOT PASS bisa ditelusuri. Tanpanya, scan yang gagal hilang
tanpa jejak dan tidak ada yang tahu label mana yang salah masuk truk.

Semua tulis lewat RPC `security definer`; RLS hanya memberi baca ke pengguna
aktif, sama seperti tabel label box.

## Pengujian

pgTAP: `030` (session + jadwal, termasuk Part No kembar dengan Qty berbeda),
`031` (PASS tanpa satu pun label di database; ukuran dan Qty diambil dari field
kedua dan ketiga payload; ejaan berspasi ganda dan huruf kecil di jadwal tetap
cocok; jadwal berspasi (`L=55 MM`) cocok dengan label yang menulisnya rapat
(`L=55MM`); payload yang sama melunasi baris kembar berikutnya; Qty sama dengan
ukuran berbeda tidak cukup untuk PASS; payload kurang dari tiga field maupun
Qty bukan bilangan bulat jatuh ke `unknown_label`; DELIVERY OK menutup session),
`032` (hapus session, cascade, ringkasan audit).

`031` sengaja tidak menyentuh `master_items`, `boxes`, `label_box_batches`,
maupun `label_boxes` — kalau salah satunya diperlukan lagi, tesnya yang gagal
lebih dulu.

Ketiganya mengembalikan `delivery_verification_session_seq` di akhir file:
`nextval()` tidak ikut rollback, dan tanpa pengembalian itu nomor session nyata
berikutnya melompat.

Vitest: parser Excel (bentuk dokumen asli, variasi ejaan header, variasi
penulisan Qty) dan komponen workspace (kartu tidak melipat diri saat scan
terakhirnya menutup session; kegagalan tak terduga tetap memunculkan toast;
payload tanpa terminator terkirim sendiri setelah ketikan berhenti).

## Keadaan

Bagian 1 dan Bagian 2 sudah jalan. Yang belum:

- **Upload PDF** — menunggu contoh dokumen asli.
- **Belum ada satu pun baris PASS lewat scan sungguhan** — payloadnya sudah
  ditangkap dari DS2208 dan cocok dengan baris 1 jadwal, dan kotak scan sudah
  terpasang, tetapi tembakan yang benar-benar melunasi sebuah baris belum
  dilakukan.
