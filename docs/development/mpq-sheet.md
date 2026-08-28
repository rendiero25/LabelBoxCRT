# MPQ Sheet

MPQ adalah jumlah sheet maksimum yang boleh masuk satu box untuk satu ukuran — misal ukuran A maksimal 5000 pcs per box. Daftarnya menyalin dokumen "List MPQ CRT" (update 27 September 2021) ke tabel `public.mpq_sheet_rows` lewat migrasi `20260828013345_mpq_sheet`, dan tampil di `/admin/mpq-sheet` dengan empat kolom: No, Ukuran, Qty MPQ, dan Unit/Box.

Tabel ini rujukan, bukan data yang tumbuh di aplikasi. Tidak ada satu pun RPC tulis: `authenticated` hanya dapat `SELECT`, satu-satunya policy adalah policy baca, dan `033_mpq_sheet.test.sql` gagal kalau grant atau policy tulis ditambahkan kelak. Revisi dokumen berikutnya masuk sebagai migrasi baru — dokumennya sendiri diganti utuh, bukan disunting baris per baris, jadi layar admin pun tidak menyediakan jalan menyuntingnya.

Ukuran disimpan dua kali. `product_size` adalah ejaan seperti di dokumen dan itulah yang dibaca admin; `product_size_key` adalah ejaan yang sama tanpa spasi, unik, dan hanya itu yang dipakai membandingkan. Alasannya sama dengan `20260827103000_match_schedule_ignoring_spaces`: dokumen kadang menulis `L=60 MM` sementara label menulis `L=60MM`. Kotak pencarian di halaman ikut membuang spasi, jadi admin yang mengetik salah satu ejaan tetap menemukan barisnya.

Dokumen memuat 651 baris, 18 di antaranya mengulang ukuran yang sama dengan MPQ dan satuan yang sama persis; yang masuk 633 baris unik, dinomori ulang 1..633 mengikuti urutan dokumen. Skrip pembangkit seed berhenti dengan galat kalau dua baris berbagi ukuran tetapi berbeda MPQ — tidak ada baris yang dipilih diam-diam. Satuannya ikut disimpan karena dokumen memuat `PCS/LAKBAN` (28 baris) selain `PCS/BOX`; angka MPQ tidak berarti tanpa satuannya.

Halaman belum terhubung ke mana-mana. Angka MPQ belum dipakai memvalidasi Qty per Box saat packing maupun saat Verifikasi Pengiriman — itu keputusan tersendiri, bukan kelalaian, dan perlu migrasi baru bila diinginkan.
