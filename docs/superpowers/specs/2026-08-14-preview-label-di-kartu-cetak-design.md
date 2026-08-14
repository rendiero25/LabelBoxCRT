# Preview label di kartu "Cetak label batch"

Tanggal: 2026-08-14

## Masalah

Operator menekan **Cetak** tanpa pernah melihat labelnya. Kalau Lot No, nomor
box, atau tanggal kiriman salah, kesalahan itu baru terbaca setelah stiker
keluar dari printer dan tertempel di box.

## Keputusan

Satu label ditampilkan sebagai preview di sisi kanan kartu "Cetak label batch":
label milik box pertama batch itu, dirender persis seperti yang dikirim ke
printer kertas.

Satu label, bukan semua: preview ini alat periksa isi kop label (supplier, part
no, lot, tanggal, QR) yang sama pada seluruh box; yang berbeda antar box hanya
nomor boxnya, dan nomor itu sudah terbaca di daftar cetak ulang.

## Syarat tampil

Tidak ada prop atau kondisi baru. Kartu cetak sendiri sudah hanya dirender
ketika seluruh box batch penuh:

- `/scan/[batchId]/verifikasi` merender `LabelBoxBatchPrintCard` di balik
  `allBoxesVerified` (`label-box-verification-console.tsx`), yang berarti setiap
  produk di setiap layer sudah tercentang hijau.
- `/scan/[batchId]/cetak` hanya bisa dibuka untuk batch yang `closed_at`-nya
  terisi, yaitu batch yang sudah lewat syarat yang sama.

Menambah prop `previewReady` hanya akan menyalin ulang aturan yang sudah dijaga
di dua tempat itu, dan salinan seperti itu yang belakangan berbeda sendiri.
Preview karena itu muncul begitu daftar print job selesai disiapkan.

## Perakitan

Sumber geometri tidak digandakan. Preview memakai jalur yang sama dengan cetak
kertas:

1. `jobs[0]` — daftar job sudah urut nomor box dari RPC-nya.
2. `formatLabelFields(job)` → `FormattedLabelFields`.
3. `QRCode.toDataURL(fields.qrPayload)` — QR sungguhan, bukan gambar contoh.
4. `buildLabelHtml(fields, qrDataUrl)` → potongan HTML berukuran milimeter.

Potongan itu disisipkan lewat `dangerouslySetInnerHTML`. Isinya dirakit sendiri
oleh aplikasi dari kolom snapshot, dan `buildLabelHtml` sudah meloloskan setiap
nilai lewat `escapeHtml`.

## Tampilan

- Isi kartu jadi dua kolom mulai `md:`: kiri kontrol cetak yang sekarang, kanan
  preview. Di layar sempit preview turun ke bawah kontrol.
- Label 75×55 mm dikecilkan dengan `transform: scale()` ke lebar tetap 260 px;
  skalanya dihitung dari `LABEL_LAYOUT` dan `LABEL_DOTS_PER_MM`, bukan angka
  yang ditulis ulang.
- Kotaknya berlatar putih dan bergaris tepi, dengan keterangan
  "Preview label · B101" di atasnya.

## Keadaan

| Keadaan                        | Kolom kanan                            |
| ------------------------------ | -------------------------------------- |
| Job belum siap (`jobs` kosong) | kosong, tanpa kerangka palsu           |
| QR atau HTML gagal dirakit     | kosong; tombol cetak tidak terpengaruh |
| Job siap                       | preview label box pertama              |

Kegagalan preview sengaja tidak memunculkan Alert: preview bukan syarat cetak,
dan peringatan merah di kartu cetak akan terbaca seolah cetaknya yang gagal.

## Tes

`label-box-batch-print-card.test.tsx` bertambah satu kasus: setelah job siap,
kartu memuat gambar QR dan teks nomor box pertama. Kasus cetak yang sudah ada
tetap berjalan tanpa perubahan.
