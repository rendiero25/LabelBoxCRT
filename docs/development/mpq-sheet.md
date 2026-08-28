# MPQ Sheet

MPQ adalah jumlah sheet maksimum yang boleh masuk satu box untuk satu ukuran — misal ukuran A maksimal 5000 pcs per box. Daftarnya menyalin dokumen "MPQ SHEET CRT 2021" (data per 27 September 2021) ke tabel `public.mpq_sheet_rows`, dan tampil di `/admin/mpq-sheet` dengan empat kolom: No, Ukuran, Qty MPQ, dan Unit/Box.

Isinya 93 ukuran, semuanya lembaran VS-B bersatuan PCS/BOX. Migrasi pertama (`20260828013345_mpq_sheet`) sempat menyalin "List MPQ CRT" utuh — 633 ukuran termasuk selang CVO/VO/EL067 — dan `20260828021520_mpq_sheet_only_sheet_sizes` membuang seluruhnya lalu mengisi ulang dari dokumen yang benar. Daftar lama dibuang, bukan ditambahi: tabel ini menyalin satu dokumen apa adanya, dan baris yang tidak ada di dokumennya membuat layar dan kertas berbeda tanpa ada yang tahu sejak kapan.

Tabel ini rujukan, bukan data yang tumbuh di aplikasi. Tidak ada satu pun RPC tulis: `authenticated` hanya dapat `SELECT`, satu-satunya policy adalah policy baca, dan `033_mpq_sheet.test.sql` gagal kalau grant atau policy tulis ditambahkan kelak. Revisi dokumen berikutnya masuk sebagai migrasi baru dengan pola yang sama — `delete` lalu `insert` — jadi layar admin tidak menyediakan jalan menyuntingnya.

Ukuran disimpan dua kali. `product_size` adalah ejaan seperti di dokumen dan itulah yang dibaca admin; `product_size_key` adalah ejaan yang sama tanpa spasi, unik, dan hanya itu yang dipakai membandingkan. Alasannya sama dengan `20260827103000_match_schedule_ignoring_spaces`: dokumen kadang menulis `L=60 MM` sementara label menulis `L=60MM`. Kotak pencarian di halaman ikut membuang spasi, jadi admin yang mengetik salah satu ejaan tetap menemukan barisnya.

Dokumen memuat 111 baris, 18 di antaranya mengulang ukuran yang sama dengan MPQ dan satuan yang sama persis; yang masuk 93 baris unik, dinomori ulang 1..93 mengikuti urutan dokumen. `scripts/build-mpq-seed.mjs` membangkitkan blok `VALUES` dari file `.xlsx` dan berhenti dengan galat kalau dua baris berbagi ukuran tetapi berbeda MPQ — tidak ada baris yang dipilih diam-diam. Satuan tetap disimpan sebagai kolom meski sekarang hanya satu nilai; angka MPQ tidak berarti tanpa satuannya, dan dokumen CRT yang lebih luas memang memuat `PCS/LAKBAN`.

Sejak `20260828025319_delivery_boxes_from_mpq`, MPQ menentukan berapa box yang harus discan di Verifikasi Pengiriman: jadwal menyimpan Qty Delivery, dan jumlah box-nya `ceil(Qty Delivery / MPQ)`. Konsekuensinya jadwal hanya menerima ukuran yang sudah terdaftar di sini — file yang memuat ukuran tanpa MPQ ditolak seluruhnya dan ukurannya disebut. Rinciannya di `docs/superpowers/specs/2026-08-21-verifikasi-pengiriman-design.md`.

Yang masih belum: MPQ tidak dipakai membatasi Qty per Box saat packing. Itu keputusan tersendiri dan perlu migrasi baru bila diinginkan.
