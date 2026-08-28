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

Tabel: **Customer**, **Part No**, **Qty Delivery**, **MPQ**, dan **Box**.
Nilainya datang dari upload Excel atau PDF.

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
halaman ini dan tidak akan pernah punya MPQ, jadi membiarkannya masuk berarti
tiap session macet dengan baris yang tidak mungkin discan. Dokumen tanpa kolom
Divisi dibaca seluruhnya, seperti dulu.

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

**MPQ** (`mpq_qty`) disalin dari MPQ Sheet saat jadwal diunggah, bukan dibaca
lewat join saat verifikasi: dokumen MPQ direvisi lewat migrasi, dan jadwal yang
truknya sedang diperiksa tidak boleh berubah jumlah box-nya di tengah jalan.

**Box** adalah `verified_boxes/expected_boxes`, keduanya kolom turunan:

```
expected_boxes = qty_delivery / mpq_qty + (qty_delivery % mpq_qty > 0)
verified_boxes = verified_qty  / mpq_qty + (verified_qty  % mpq_qty > 0)
```

8000 keping dengan MPQ 2000 berarti 4 box. 7000 keping dengan MPQ 1500 berarti
5 box: empat box penuh 1500 dan satu box sisa 1000 — sisa yang tidak penuh tetap
minta satu box sendiri, jadi pembulatannya ke atas. Yang disimpan jumlah keping
(`verified_qty`), bukan jumlah box: dari keping jumlah box bisa dihitung pasti,
dari jumlah box komposisi penuh/sisa tidak bisa dipulihkan.

**Ukuran yang belum ada di MPQ Sheet tetap masuk jadwal**, dengan `mpq_qty`
null. Aturan sebelumnya menolak seluruh file, dan dokumen nyata membatalkannya:
dari 13 baris sheet pada DO Report 21 Agustus 2026, delapan belum punya MPQ —
empat di antaranya VS-B milik CIPTA MANDIRI yang memang dikirim rutin. Daftar
MPQ 2021 ketinggalan dari yang berjalan sekarang, jadi menolak berarti tidak
ada satu pun jadwal yang bisa diunggah sampai daftarnya dikejar.

Barisnya karena itu terlihat di tabel bertanda **"MPQ belum ada"**, scan-nya
ditolak dengan sebab itu, dan ia tidak pernah lunas — jadi session-nya tidak
bisa DELIVERY OK sebelum MPQ-nya ditambahkan. Kurangnya terlihat, bukan hilang.
Kepala kartu menyebut jumlahnya tersendiri ("8 ukuran belum ada MPQ-nya") sebab
baris tanpa MPQ tidak menyumbang box ke hitungan sama sekali: tanpa penyebutan
itu, "6/6 box" akan terbaca lunas padahal masih ada kiriman yang belum
diperiksa.

Jumlah box baris semacam itu null, bukan 0 — yang akan terbaca "tidak butuh box
sama sekali" — dan bukan 1, yang akan membuat kiriman 7500 keping lunas oleh
satu label.

Baris jadwal yang sudah ada sebelum migrasi ini diberi `mpq_qty = qty_delivery`,
jadi jumlah box-nya tetap satu. Baris-baris itu diisi dan diperiksa di bawah
aturan lama, dan menghitungnya ulang dengan aturan baru akan mengubah Session
yang sudah DELIVERY OK menjadi kurang — yaitu memalsukan pemeriksaan yang
benar-benar terjadi.

Satu file boleh memuat satu baris maupun banyak; parser membaca semua yang ada
lalu menambahkannya ke bawah tabel. Upload berikutnya menambah lagi, tidak
menimpa. Ukuran yang sudah ada **jadi baris sendiri** — dua kiriman ukuran
sama adalah dua baris jadwal, masing-masing dengan jumlah box sendiri.

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

| Jadwal  | Payload |
| ------- | ------- |
| Part No | field 2 |
| Qty box | field 3 |

Field lain — kode supplier, lot, tanggal — tidak dibaca sama sekali: tidak ada
yang meminta keduanya diperiksa, dan setiap field tambahan yang dibaca adalah
satu cara baru sebuah scan gagal.

Sebuah scan diterima kalau ada baris jadwal berukuran sama yang masih kurang
box, **dan** Qty-nya salah satu dari dua nilai yang sah untuk baris itu:

- **MPQ**, selama box penuh masih kurang; atau
- **sisanya** (`qty_delivery % mpq_qty`), selama box sisa belum pernah masuk.

Qty ikut diperiksa, tidak sekadar dihitung banyaknya scan: menghitung scan saja
akan meloloskan empat box @1500 sebagai kiriman 8000 keping, dan selisih 2000
keping itu baru ketahuan di tempat pelanggan.

Komposisi yang sudah masuk dibaca dari `verified_qty` saja. Sisa selalu lebih
kecil dari MPQ, jadi `verified_qty % mpq_qty` menjawab pasti apakah box sisa
sudah terambil — tidak perlu penghitung kedua yang bisa berselisih dengannya.

**Urutan scan tidak diatur.** Box sisa boleh ditembak lebih dulu: yang dijaga
komposisinya — sekian box penuh dan paling banyak satu box sisa — bukan giliran
operator mengambil box dari palet.

Baris lunas ketika `verified_qty = qty_delivery`, dan session selesai ketika
seluruh barisnya lunas.

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

| Keadaan                                                    | `result`        | Toast                                             | Tabel                      |
| ---------------------------------------------------------- | --------------- | ------------------------------------------------- | -------------------------- |
| Qty sah, baris masih kurang box                            | `pass`          | **PASS** — box 2/5, sisa 3 box                    | kolom Box bertambah        |
| Qty sah, box terakhir baris itu                            | `pass`          | **PASS** — lengkap 5/5 box                        | centang hijau di baris itu |
| Ukuran ada di jadwal, Qty bukan MPQ maupun sisanya         | `not_pass`      | **NOT PASS** — butuh Qty 1500 (box terakhir 1000) | tidak berubah              |
| Ukuran ada di jadwal tetapi box-nya sudah lengkap          | `not_pass`      | **NOT PASS** — sudah lengkap 5 box                | tidak berubah              |
| Ukuran ada di jadwal tetapi MPQ-nya belum ada              | `not_pass`      | **NOT PASS** — belum ada di MPQ Sheet             | tidak berubah              |
| Ukuran tidak ada di jadwal sama sekali                     | `not_pass`      | **NOT PASS** — tidak ada baris jadwal             | tidak berubah              |
| Kurang dari 3 field, atau Qty bukan bilangan bulat positif | `unknown_label` | **NOT PASS** — QR tidak terbaca                   | tidak berubah              |
| Baris terakhir baru saja lunas                             | `pass`          | **DELIVERY OK** menyusul PASS-nya                 | session jadi `done`        |

`unknown_label` dibedakan dari `not_pass` karena keduanya menuntut tindakan
berbeda: yang satu berarti QR-nya tidak terbaca, yang lain berarti QR terbaca
tetapi barangnya bukan yang dijadwalkan.

Keempat bentuk `not_pass` dibedakan di kalimatnya karena menuntut tindakan
berbeda pula: mengambil box lain, berhenti karena kiriman sudah cukup, menambah
MPQ di halaman MPQ Sheet, atau melapor bahwa ada ukuran yang tidak dijadwalkan.
"NOT PASS" belaka membuat operator menembak ulang label yang sama — dan untuk
ukuran tanpa MPQ, menembak ulang tidak akan pernah menolong. Kalimatnya dibangun
`scan-message.ts`, terpisah dari `actions.ts` karena berkas `"use server"`
hanya boleh mengekspor fungsi async — dan itu satu-satunya bagian verifikasi
yang bisa diuji tanpa database.

**Scan dobel tidak dicek.** `duplicate_label` bertumpu pada identitas label
fisik di `label_boxes`, dan identitas itu sudah tidak ada; field keempat payload
memang berbeda antar label, tetapi memakainya berarti memutuskan diam-diam
bahwa penulisannya konsisten, dan itu belum diperiksa. Konsekuensinya diterima
sadar: satu box penuh yang ditembak dua kali dihitung sebagai dua box, dan
session bisa tutup dengan satu box kurang di truk. Yang membatasinya cuma
komposisi — box sisa tidak bisa masuk dua kali, dan jumlah box penuh tidak bisa
melebihi `qty_delivery / mpq_qty`. `delivery_verification_scans` tetap mencatat
tiap scan beserta payload mentahnya, jadi kejadian itu masih bisa ditelusuri
sesudahnya.

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
  qty_delivery, mpq_qty, verified_qty,      -- mpq_qty null = belum ada di MPQ Sheet
  expected_boxes, verified_boxes            -- kolom turunan; null kalau mpq_qty null
  verified_at, verified_label_box_id        -- selalu null; label_boxes tak dipakai

mpq_sheet_rows                              -- rujukan, hanya dibaca
  id, row_no, product_size, product_size_key, mpq_qty, unit

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
`031` (kedua contoh lantai produksi dikunci sebagai tes — 8000 keping/MPQ 2000
jadi 4 box, 7000 keping/MPQ 1500 jadi 5 box dengan box sisa ditembak lebih
dulu; Qty yang bukan MPQ maupun sisanya ditolak; box sisa kedua ditolak; box
berlebih setelah baris lengkap dibedakan lewat `size_complete`; penolakan
menyebut Qty yang seharusnya; jadwal berspasi cocok dengan label yang
menulisnya rapat; Customer tersimpan per baris; ukuran tanpa MPQ tetap masuk
dengan `mpq_qty` dan `expected_boxes` null, ditolak saat scan lewat
`mpq_missing`, dan menahan session tetap terbuka; `unknown_label`; DELIVERY OK
menutup session), `032` (hapus session, cascade, ringkasan audit), `033` (MPQ
Sheet hanya bisa dibaca dan isinya utuh).

`031` sengaja tidak menyentuh `master_items`, `boxes`, `label_box_batches`,
maupun `label_boxes` — kalau salah satunya diperlukan lagi, tesnya yang gagal
lebih dulu.

`030`, `031`, dan `032` menyisipkan barisnya sendiri ke `mpq_sheet_rows` lebih
dulu: sejak jadwal menolak ukuran tanpa MPQ, ukuran uji pun perlu MPQ.

Ketiganya mengembalikan `delivery_verification_session_seq` di akhir file:
`nextval()` tidak ikut rollback, dan tanpa pengembalian itu nomor session nyata
berikutnya melompat.

Vitest: parser Excel (bentuk DO Report — Customer/Item No/Qty diambil, "Customer
PONo" tidak tertukar jadi customer, hanya divisi sheet yang lewat, Qty tak
terbaca di divisi yang dilewati tidak menggagalkan file, baris ber-Qty nol
dilewati, file tube-saja dibedakan dari file rusak; ditambah bentuk dokumen
lama, variasi ejaan header, variasi penulisan Qty), `scan-message.ts` (kedelapan
kalimat, termasuk sisa box, Qty yang seharusnya, dan MPQ yang belum ada), dan
komponen workspace (kartu tidak melipat diri saat scan
terakhirnya menutup session; kegagalan tak terduga tetap memunculkan toast;
payload tanpa terminator terkirim sendiri setelah ketikan berhenti).

## Keadaan

Bagian 1 dan Bagian 2 sudah jalan. Session 5 sudah DELIVERY OK lewat scan
sungguhan dengan DS2208, dan DO Report 21 Agustus 2026 sudah terbaca utuh lewat
halaman: 13 baris sheet dari 137, Customer terisi, lima ukuran ber-MPQ dan
delapan bertanda "MPQ belum ada". Yang belum:

- **Upload PDF** — menunggu contoh dokumen asli.
- **Delapan ukuran sheet belum ada di MPQ Sheet**, empat di antaranya VS-B milik
  CIPTA MANDIRI (`L=230MM`, `L=195MM`, `L=250MM`, `L=255MM`) dan empat VS-A
  milik INDOPRIMA. Selama itu, jadwal yang memuatnya tidak bisa DELIVERY OK.
- **Belum ada jadwal berbox-banyak yang diverifikasi sungguhan.** Aturan banyak
  box terbukti di pgTAP, belum di lantai produksi.
