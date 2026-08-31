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

Tabel: **Customer**, **Part No**, **Qty Delivery**, **Terscan**, dan **Box**.
Tiga yang pertama datang dari upload Excel atau PDF; dua terakhir dihitung dari
scan.

### Dokumen sumber: DO Report

Bentuk yang dipakai seterusnya adalah DO Report, satu file per rentang tanggal
dengan header di baris pertama:

```
DO Date | DONo | Customer PONo | Customer No | Customer | DNNo |
Item No | Description | Qty | Unit Price | Divisi
```

Yang dibaca tiga kolom: **Customer**, **Item No** (ukuran sheet), dan **Qty**
(Qty Delivery). Sisanya lewat.

Kolom Customer dicocokkan **persis**, bukan lewat `includes`. "Customer PONo"
dan "Customer No" berdiri lebih dulu di baris header, dan pencocokan longgar
akan mengambil nomor PO sebagai nama customer — salah yang tidak kelihatan
sampai ada yang membaca tabelnya. Nama kolom ukuran menerima "Item No" maupun
"Part No"; dokumen jadwal lama memakai yang kedua.

**Hanya baris berdivisi sheet yang diambil**, kalau kolom Divisi ada. Satu DO
Report memuat seluruh divisi: pada file 21 Agustus 2026, dari 137 baris hanya
13 yang sheet — 119 tube dan 5 kabel. Tube dan kabel tidak diverifikasi di
halaman ini, jadi membiarkannya masuk berarti tiap session menyeret ratusan
baris yang tidak akan pernah discan siapa pun. Dokumen tanpa kolom Divisi
dibaca seluruhnya, seperti dulu.

Divisi disaring **sebelum** Qty dibaca. Baris tube kerap ber-Qty kosong, dan
baris semacam itu tidak boleh menggagalkan file jadwal sheet.

Baris ber-Qty nol dilewati: barangnya tidak jadi dikirim, jadi tidak ada yang
perlu diverifikasi. Itu dibedakan dari Qty yang tidak terbaca, yang tetap
menggagalkan seluruh file. File yang ada isinya tetapi tidak memuat satu pun
baris sheet ditolak dengan `SCHEDULE_NO_SHEET_ROWS` — bukan dokumen rusak, cuma
bukan jadwal sheet, dan pesannya harus mengatakan itu.

Kolom Customer disimpan per baris karena satu file memuat beberapa customer
sekaligus; tanpa kolomnya operator tidak bisa tahu kiriman siapa yang sedang
ia periksa. Jadwal yang diunggah sebelum kolom ini ada bernilai null.

Ukuran produk seperti tertulis di label — `VS-B T0.3XW100 L=120MM`. Nama kolom
databasenya `product_size`.

**Qty Delivery** (`qty_delivery`) adalah seluruh jumlah yang dikirim untuk
ukuran itu, bukan isi satu box. Sampai migrasi `20260828025319` kolom ini
bernama `qty` dan dibaca sebagai Qty per Box: satu baris lunas oleh satu label.
Nama dan artinya berganti bersama-sama — membiarkannya bernama `qty` sementara
artinya berubah total adalah cara termurah membuat pembaca berikutnya salah.

**Terscan** (`verified_qty`) adalah jumlah keping yang sudah masuk. Barisnya
lunas ketika angka itu sama dengan Qty Delivery. **Box** (`verified_boxes`) cuma
keterangan: berapa kali label ukuran itu diterima, dihitung sistem, tanpa target
untuk dibandingkan.

Berapa box yang dipakai tidak diatur (`20260831050400`). Kiriman 5000 boleh
datang sebagai 2500+2500 maupun 3000+1500+500; yang dijaga totalnya.

Jumlah box pernah dua kali dipakai sebagai penentu dan dua kali dilepas — lihat
"Aturan yang sempat salah" di bawah. MPQ Sheet ikut lepas bersamanya; daftarnya
tetap ada di `/admin/mpq-sheet` sebagai rujukan yang tidak dibaca kode mana pun.

**Qty yang melebihi sisa ditolak.** Menerimanya berarti kiriman tercatat lebih
banyak daripada yang dijadwalkan, dan selisihnya tidak akan pernah ketahuan dari
tabel. Penolakannya menyebut sisa yang sebenarnya, sebab tanpa angka itu operator
tidak bisa membedakan salah ambil box dari salah baris.

Saat satu ukuran punya lebih dari satu baris jadwal, yang **sisanya terkecil**
didahulukan. Dua kiriman berukuran sama karena itu diselesaikan satu per satu,
bukan terisi separuh-separuh.

Baris yang sudah lunas sebelum `20260831050400` tetap lunas: `verified_qty`-nya
diisi sebesar Qty Delivery. Yang belum lunas dikembalikan ke nol — jumlah
kepingnya tidak bisa dipulihkan dari catatan scan, sebab payload lama berisi
angka yang diterima aturan lama, bukan isi box sungguhan.

Satu file boleh memuat satu baris maupun banyak; parser membaca semua yang ada
lalu menambahkannya ke bawah tabel. Upload berikutnya menambah lagi, tidak
menimpa. Ukuran yang sudah ada **jadi baris sendiri** — dua kiriman ukuran
sama adalah dua baris jadwal, masing-masing dengan Qty Delivery sendiri.

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
       ^ field 2: ukuran produk        ^ field 3: Qty box ini
```

| Jadwal             | Payload |
| ------------------ | ------- |
| Part No            | field 2 |
| dijumlahkan ke Qty | field 3 |

Field lain — kode supplier, lot, tanggal — tidak dibaca sama sekali: tidak ada
yang meminta keduanya diperiksa, dan setiap field tambahan yang dibaca adalah
satu cara baru sebuah scan gagal.

**Angka di field ketiga adalah Qty box yang dipegang**, bukan Qty Delivery.
Operator menembak box demi box dan angkanya dijumlahkan.

Sebuah scan diterima kalau ada baris jadwal berukuran sama yang sisanya masih
memuat Qty itu. Barisnya lunas ketika `verified_qty = qty_delivery`, dan session
selesai ketika seluruh barisnya lunas. Kiriman 5000 boleh datang sebagai
2500+2500 maupun 3000+1500+500.

### Aturan yang sempat salah

Arti field ketiga sempat ditebak dua kali, dan dua-duanya salah.

`20260828025319` menganggap tiap box ber-Qty MPQ dengan box terakhir ber-Qty
sisanya. `20260828075811` menggantinya dengan "semua box berlabel Qty Delivery
yang sama", dan `20260831050400` membetulkan keduanya: field ketiga adalah Qty
box itu sendiri, dan yang dijumlahkan.

Yang membuat dua tebakan pertama bertahan adalah data yang menyesatkan.
Sebagian besar baris kebetulan berjumlah satu box atau ber-Qty box sama dengan
Qty Delivery-nya; pada keadaan itu ketiga tafsir bernilai sama. Lebih buruk,
Session 15 dan 18 penuh scan berangka persis Qty Delivery — sembilan kali `1500`
untuk kiriman 1500 pada satu baris — yang terbaca sebagai bukti kuat bagi tafsir
kedua. Itu bukan sembilan box: itu operator menembak satu label berulang kali
demi memenuhi jumlah box yang diminta aturan waktu itu.

Buktinya yang sungguh ada justru di antara scan yang **ditolak**: Session 4,
ukuran `VS-B T0.3XW100 L=185MM` ber-Qty Delivery 3000, ditembak tiga kali dengan
label ber-Qty 1500, semuanya NOT PASS. Label per-box yang benar, ditolak aturan
yang salah.

Dua pelajaran, dan yang kedua yang mahal:

1. Contoh yang membedakan dua tafsir harus dicari lebih dulu, bukan ditunggu
   sampai muncul di lantai produksi.
2. **Data yang dihasilkan sebuah aturan tidak bisa dipakai membenarkan aturan
   itu.** Scan yang diterima sudah tersaring oleh aturan yang sedang berlaku,
   jadi ia selalu terlihat mendukungnya. Yang ditolak yang berisi kabar baru.

### Konsekuensi: dua box tidak bisa dibedakan

QR tidak membawa identitas box, jadi dua box berukuran dan ber-Qty sama tidak
bisa dibedakan. Satu box yang ditembak dua kali terhitung dua box. Cek dobel
memang sudah dimatikan sejak awal atas keputusan pemilik; sekarang bahannya
memang tidak ada. Yang membatasinya tinggal total Qty Delivery — kelebihan
ditolak — dan `delivery_verification_scans` yang mencatat tiap tembakan beserta
payload mentahnya.

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

| Keadaan                                                    | `result`        | Toast                                          | Tabel                      |
| ---------------------------------------------------------- | --------------- | ---------------------------------------------- | -------------------------- |
| Qty muat pada sisa, baris belum lunas                      | `pass`          | **PASS** — 2000/5000 pcs, 1 box. Sisa 3000 pcs | Terscan dan Box bertambah  |
| Qty menutup sisanya                                        | `pass`          | **PASS** — lengkap 5000 pcs dalam 3 box        | centang hijau di baris itu |
| Ukuran ada di jadwal, Qty melebihi sisa                    | `not_pass`      | **NOT PASS** — sisa 3000 pcs, QR ini 4000 pcs  | tidak berubah              |
| Ukuran ada di jadwal tetapi sudah lengkap                  | `not_pass`      | **NOT PASS** — sudah lengkap 5000 pcs          | tidak berubah              |
| Ukuran tidak ada di jadwal sama sekali                     | `not_pass`      | **NOT PASS** — tidak ada baris jadwal          | tidak berubah              |
| Kurang dari 3 field, atau Qty bukan bilangan bulat positif | `unknown_label` | **NOT PASS** — QR tidak terbaca                | tidak berubah              |
| Baris terakhir baru saja lunas                             | `pass`          | **DELIVERY OK** menyusul PASS-nya              | session jadi `done`        |

`unknown_label` dibedakan dari `not_pass` karena keduanya menuntut tindakan
berbeda: yang satu berarti QR-nya tidak terbaca, yang lain berarti QR terbaca
tetapi barangnya bukan yang dijadwalkan.

Ketiga bentuk `not_pass` dibedakan di kalimatnya karena menuntut tindakan
berbeda pula: mengambil box lain, berhenti karena kiriman sudah cukup, atau
melapor bahwa ada ukuran yang tidak dijadwalkan. "NOT PASS" belaka membuat
operator menembak ulang label yang sama. Kalimatnya dibangun `scan-message.ts`,
terpisah dari `actions.ts` karena berkas `"use server"` hanya boleh mengekspor
fungsi async — dan itu satu-satunya bagian verifikasi yang bisa diuji tanpa
database.

**Scan dobel tidak dicek.** `duplicate_label` bertumpu pada identitas label
fisik di `label_boxes`, dan identitas itu sudah tidak ada; field keempat payload
memang berbeda antar label, tetapi memakainya berarti memutuskan diam-diam
bahwa penulisannya konsisten, dan itu belum diperiksa. Konsekuensinya diterima
sadar: dua box ber-Qty sama tidak bisa dibedakan dari satu box yang ditembak dua
kali, jadi session bisa tutup dengan satu box kurang di truk. Yang membatasinya
total Qty Delivery — kelebihan ditolak — dan `delivery_verification_scans` yang
mencatat tiap scan beserta payload mentahnya.

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
  id, session_id, row_no, customer, product_size, source_file_name, created_at,
  qty_delivery,
  verified_qty,                             -- keping yang sudah masuk; lunas = qty_delivery
  verified_boxes,                           -- keterangan, naik satu tiap scan
  verified_at, verified_label_box_id        -- selalu null; label_boxes tak dipakai

-- mpq_sheet_rows tidak lagi dipakai halaman ini; daftarnya tetap ada di
-- /admin/mpq-sheet sebagai rujukan tersendiri.

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
`031` (kiriman 5000 lunas oleh 2000+2500+500 — jumlah box tidak diatur, dan
box-nya dihitung sendiri jadi 3; Qty yang melebihi sisa ditolak dan tidak
menambah apa pun; penolakannya menyebut sisa yang sebenarnya; satu box sebesar
kirimannya tetap sah sekali tembak; box berlebih sesudah lunas dibedakan lewat
`size_complete`; jadwal berspasi cocok dengan label yang menulisnya rapat;
Customer tersimpan per baris; ukuran di luar jadwal ditolak; `unknown_label`;
hitungan session dalam keping, bukan box; DELIVERY OK menutup session),
`032` (hapus session, cascade, ringkasan audit), `033` (MPQ
Sheet: tulisnya hanya lewat RPC khusus admin, isinya utuh, ukuran kembar
ditolak, dan keempat RPC-nya — tambah, edit, nonaktifkan, hapus).

`031` sengaja tidak menyentuh `master_items`, `boxes`, `label_box_batches`,
`label_boxes`, maupun `mpq_sheet_rows` — kalau salah satunya diperlukan lagi,
tesnya yang gagal lebih dulu.

Ketiganya mengembalikan `delivery_verification_session_seq` di akhir file:
`nextval()` tidak ikut rollback, dan tanpa pengembalian itu nomor session nyata
berikutnya melompat.

Vitest: parser Excel (bentuk DO Report — Customer/Item No/Qty diambil, "Customer
PONo" tidak tertukar jadi customer, hanya divisi sheet yang lewat, Qty tak
terbaca di divisi yang dilewati tidak menggagalkan file, baris ber-Qty nol
dilewati, file tube-saja dibedakan dari file rusak; ditambah bentuk dokumen
lama, variasi ejaan header, variasi penulisan Qty), `scan-message.ts` (keenam
kalimat, termasuk sisa keping dan box yang tidak muat), dan
komponen workspace (kartu tidak melipat diri saat scan
terakhirnya menutup session; kegagalan tak terduga tetap memunculkan toast;
payload tanpa terminator terkirim sendiri setelah ketikan berhenti).

## Keadaan

Bagian 1 dan Bagian 2 sudah jalan. DO Report sudah terbaca utuh lewat halaman:
13 baris sheet dari 137, Customer terisi. Yang belum:

- **Upload PDF** — menunggu contoh dokumen asli.
- **Aturan penjumlahan Qty belum diuji di lantai produksi.** Terbukti di pgTAP,
  dan halaman belum sempat dilihat karena sesi login habis saat pengerjaannya.
- **Session lama memegang hitungan dari aturan lama.** Session 15 dan 18 lunas
  lewat scan berulang atas satu label; `verified_boxes`-nya menghitung tembakan,
  bukan box sungguhan. Angka itu dibiarkan sebagai catatan apa yang terjadi.
