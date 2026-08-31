# MPQ Sheet

MPQ adalah jumlah sheet maksimum yang boleh masuk satu box untuk satu ukuran — misal ukuran A maksimal 5000 pcs per box. Daftarnya menyalin dokumen "MPQ SHEET CRT 2021" (data per 27 September 2021) ke tabel `public.mpq_sheet_rows`, dan tampil di `/admin/mpq-sheet` dengan empat kolom: No, Ukuran, Qty MPQ, dan Unit/Box.

Isinya 93 ukuran, semuanya lembaran VS-B bersatuan PCS/BOX. Migrasi pertama (`20260828013345_mpq_sheet`) sempat menyalin "List MPQ CRT" utuh — 633 ukuran termasuk selang CVO/VO/EL067 — dan `20260828021520_mpq_sheet_only_sheet_sizes` membuang seluruhnya lalu mengisi ulang dari dokumen yang benar. Daftar lama dibuang, bukan ditambahi: tabel ini menyalin satu dokumen apa adanya, dan baris yang tidak ada di dokumennya membuat layar dan kertas berbeda tanpa ada yang tahu sejak kapan.

Daftarnya bisa disunting admin dari layar: tambah, edit, nonaktifkan, hapus (`20260828063230`). Rancangan awalnya hanya-baca — revisi masuk sebagai migrasi — dan yang membatalkannya dokumen itu sendiri: MPQ bertanggal 2021, sementara DO Report 2026 memuat ukuran yang belum ada di dalamnya. Menunggu migrasi berarti menahan pekerjaan sampai ada yang sempat menulis SQL.

Tulisnya lewat RPC `security definer` dan khusus admin. `authenticated` hanya punya `SELECT`, satu-satunya policy adalah policy baca, dan `033_mpq_sheet.test.sql` gagal kalau grant atau policy tulis ditambahkan kelak. Tiap mutasi teraudit ke `audit_logs`.

Nomor urut baris baru melanjutkan yang terakhir, dan baris yang dihapus meninggalkan lubang. Nomor itu cuma jangkar urutan tampilan; menomori ulang seluruh tabel setiap kali satu baris dibuang akan memindahkan baris-baris yang tidak disentuh siapa pun.

Ukuran disimpan dua kali. `product_size` adalah ejaan seperti di dokumen dan itulah yang dibaca admin; `product_size_key` adalah ejaan yang sama tanpa spasi, unik, dan hanya itu yang dipakai membandingkan. Alasannya sama dengan `20260827103000_match_schedule_ignoring_spaces`: dokumen kadang menulis `L=60 MM` sementara label menulis `L=60MM`. Kotak pencarian di halaman ikut membuang spasi, jadi admin yang mengetik salah satu ejaan tetap menemukan barisnya.

Dokumen memuat 111 baris, 18 di antaranya mengulang ukuran yang sama dengan MPQ dan satuan yang sama persis; yang masuk 93 baris unik, dinomori 1..93 mengikuti urutan dokumen. `scripts/build-mpq-seed.mjs` membangkitkan blok `VALUES` dari file `.xlsx` dan berhenti dengan galat kalau dua baris berbagi ukuran tetapi berbeda MPQ — tidak ada baris yang dipilih diam-diam. Skrip itu untuk mengganti daftar utuh dari dokumen baru; penambahan satu-satu dikerjakan dari layar. Satuan tetap disimpan sebagai kolom meski sekarang hanya satu nilai; angka MPQ tidak berarti tanpa satuannya, dan dokumen CRT yang lebih luas memang memuat `PCS/LAKBAN`.

## Tidak dipakai fitur mana pun

Antara `20260828025319` dan `20260828091159`, MPQ menentukan berapa box yang harus discan di Verifikasi Pengiriman: `ceil(Qty Delivery / MPQ)`. Itu dilepas. MPQ cuma batas atas — box boleh diisi kurang, dan satu kiriman bisa dipecah tidak rata — jadi menurunkan jumlah box darinya berarti menebak, dan tebakan itu menolak scan yang benar. Sekarang operator mengetik jumlah box-nya sendiri; rinciannya di `docs/superpowers/specs/2026-08-21-verifikasi-pengiriman-design.md`.

Daftar ini karena itu berdiri sendiri: dibaca manusia, tidak dibaca kode mana pun. Ia dipertahankan atas permintaan pemilik sebagai rujukan, dan kalau kelak dipakai lagi — misal membatasi Qty per Box saat packing — yang memakainya harus tahu bahwa isinya bertanggal 2021 dan tertinggal dari yang dikirim sekarang.
