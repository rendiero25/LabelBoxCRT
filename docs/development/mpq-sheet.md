# MPQ Sheet

MPQ adalah jumlah sheet maksimum yang boleh masuk satu box untuk satu ukuran — misal ukuran A maksimal 5000 pcs per box. Daftarnya menyalin dokumen "MPQ SHEET CRT 2021" (data per 27 September 2021) ke tabel `public.mpq_sheet_rows`, dan tampil di `/admin/mpq-sheet` dengan empat kolom: No, Ukuran, Qty MPQ, dan Unit/Box.

Isinya 93 ukuran, semuanya lembaran VS-B bersatuan PCS/BOX. Migrasi pertama (`20260828013345_mpq_sheet`) sempat menyalin "List MPQ CRT" utuh — 633 ukuran termasuk selang CVO/VO/EL067 — dan `20260828021520_mpq_sheet_only_sheet_sizes` membuang seluruhnya lalu mengisi ulang dari dokumen yang benar. Daftar lama dibuang, bukan ditambahi: tabel ini menyalin satu dokumen apa adanya, dan baris yang tidak ada di dokumennya membuat layar dan kertas berbeda tanpa ada yang tahu sejak kapan.

Daftarnya bisa disunting admin dari layar: tambah, edit, nonaktifkan, hapus (`20260828063230`). Rancangan awalnya hanya-baca — revisi masuk sebagai migrasi — dan yang membatalkannya dokumen itu sendiri: MPQ bertanggal 2021, sementara DO Report 2026 memuat ukuran yang belum ada di dalamnya, dan selama satu ukuran belum punya MPQ jadwal yang memuatnya tidak bisa DELIVERY OK. Menunggu migrasi berarti menahan pemeriksaan kiriman sampai ada yang sempat menulis SQL.

Yang tidak berubah: tulisnya tetap lewat RPC `security definer` dan tetap khusus admin. `authenticated` masih hanya punya `SELECT`, satu-satunya policy tetap policy baca, dan `033_mpq_sheet.test.sql` gagal kalau grant atau policy tulis ditambahkan kelak. Tiap mutasi teraudit ke `audit_logs`.

**Nonaktifkan** bukan sekadar label: `add_delivery_schedule_rows` hanya membaca MPQ yang aktif, jadi ukuran nonaktif diperlakukan jadwal baru seperti belum punya MPQ sama sekali. Menyunting maupun menghapus tidak menyentuh jadwal yang sedang berjalan — jadwal menyalin MPQ ke barisnya sendiri saat diunggah, supaya truk yang sedang diperiksa tidak berubah jumlah box-nya di tengah jalan.

Nomor urut baris baru melanjutkan yang terakhir, dan baris yang dihapus meninggalkan lubang. Nomor itu cuma jangkar urutan tampilan; menomori ulang seluruh tabel setiap kali satu baris dibuang akan memindahkan baris-baris yang tidak disentuh siapa pun.

Ukuran disimpan dua kali. `product_size` adalah ejaan seperti di dokumen dan itulah yang dibaca admin; `product_size_key` adalah ejaan yang sama tanpa spasi, unik, dan hanya itu yang dipakai membandingkan. Alasannya sama dengan `20260827103000_match_schedule_ignoring_spaces`: dokumen kadang menulis `L=60 MM` sementara label menulis `L=60MM`. Kotak pencarian di halaman ikut membuang spasi, jadi admin yang mengetik salah satu ejaan tetap menemukan barisnya.

Dokumen memuat 111 baris, 18 di antaranya mengulang ukuran yang sama dengan MPQ dan satuan yang sama persis; yang masuk 93 baris unik, dinomori 1..93 mengikuti urutan dokumen. `scripts/build-mpq-seed.mjs` membangkitkan blok `VALUES` dari file `.xlsx` dan berhenti dengan galat kalau dua baris berbagi ukuran tetapi berbeda MPQ — tidak ada baris yang dipilih diam-diam. Skrip itu untuk mengganti daftar utuh dari dokumen baru; penambahan satu-satu dikerjakan dari layar. Satuan tetap disimpan sebagai kolom meski sekarang hanya satu nilai; angka MPQ tidak berarti tanpa satuannya, dan dokumen CRT yang lebih luas memang memuat `PCS/LAKBAN`.

Sejak `20260828025319_delivery_boxes_from_mpq`, MPQ menentukan berapa box yang harus discan di Verifikasi Pengiriman: jadwal menyimpan Qty Delivery, dan jumlah box-nya `ceil(Qty Delivery / MPQ)`. Ukuran yang belum terdaftar di sini tetap masuk jadwal tetapi bertanda "MPQ belum ada" dan tidak bisa discan, sehingga session-nya tidak bisa DELIVERY OK sampai MPQ-nya ditambahkan (`20260828035015`). Rinciannya di `docs/superpowers/specs/2026-08-21-verifikasi-pengiriman-design.md`.

Daftar ini karena itu perlu dikejar, bukan dianggap selesai. DO Report 21 Agustus 2026 memuat delapan ukuran sheet yang belum ada di sini — empat VS-B milik CIPTA MANDIRI (`L=230MM`, `L=195MM`, `L=250MM`, `L=255MM`) dan empat VS-A milik INDOPRIMA. Dokumen MPQ yang dipakai bertanggal 2021; yang dikirim sekarang sudah lebih luas.

Yang masih belum: MPQ tidak dipakai membatasi Qty per Box saat packing. Itu keputusan tersendiri dan perlu migrasi baru bila diinginkan.
