# Hardware Discovery dan UAT

## Discovery lokal — 13 Juli 2026

Pemeriksaan dilakukan pada workstation tempat repository dibuka. Belum ada
konfirmasi bahwa mesin ini adalah workstation produksi.

| Item           | Hasil                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------ |
| OS             | Microsoft Windows 10 build 19045, x64                                                      |
| Microsoft Edge | 150.0.4078.65 terdeteksi                                                                   |
| Google Chrome  | 149.0.7827.201 terdeteksi                                                                  |
| Browser target | **Proposal: Edge** untuk workstation Windows; approval IT pending                          |
| Zebra DS2208   | Belum tersedia; perangkat masih dalam pengiriman menurut owner                             |
| Zebra ZD220    | Dilaporkan menyala oleh owner, tetapi `Get-Printer` belum mengembalikan printer/driver     |
| QZ Tray        | Terverifikasi terpasang di `C:\Program Files\QZ Tray`; proses tidak aktif saat pemeriksaan |
| Zebra software | ZebraDesigner 3 terdeteksi di `C:\Program Files\Zebra Technologies`                        |

Versi browser adalah evidence bertanggal, bukan minimum version aplikasi.

## Identitas hardware yang harus diisi

| Field                            | Nilai                                                             |
| -------------------------------- | ----------------------------------------------------------------- |
| Workstation asset/name           | Pending                                                           |
| Windows edition/build production | Pending                                                           |
| Scanner serial/asset             | Pending                                                           |
| Scanner firmware                 | Pending                                                           |
| Printer serial/asset             | Pending                                                           |
| Exact Windows printer name       | Pending                                                           |
| Printer driver/version           | Pending                                                           |
| ZD220 resolution                 | 203 dpi menurut spesifikasi vendor; verifikasi unit fisik pending |
| Media width × height             | Pending                                                           |
| Detection                        | Pending: gap / black mark / continuous                            |
| Gap/black-mark dimension         | Pending                                                           |
| Print orientation                | Pending                                                           |

Power-on perangkat belum membuktikan instalasi driver, Windows printer mapping,
atau kemampuan raw print. Checklist test tetap `NOT RUN` sampai bukti tersedia.

ZD220 mendukung 203 dpi (8 dots/mm), lebar cetak maksimum 104 mm, dan media
gap/black line/notch. Spesifikasi model tidak menggantikan pengukuran media dan
verifikasi unit fisik.

## UAT DS2208

1. Hubungkan DS2208 langsung ke workstation produksi melalui USB.
2. Buka Notepad dengan keyboard layout yang sama seperti operator.
3. Scan tiap sample QR dan simpan raw payload redacted beserta timestamp.
4. Verifikasi kursor berpindah baris tepat satu kali setelah setiap scan.
5. Jalankan 100 scan beruntun dengan set label yang dapat mengungkap karakter
   yang salah, scan hilang, scan tergabung, dan terminator ganda.
6. Catat `PASS` hanya bila 100/100 payload identik dengan expected payload dan
   100/100 memiliki satu terminator Enter.

| Test                  | Operator | Tanggal | Hasil   | Evidence/catatan |
| --------------------- | -------- | ------- | ------- | ---------------- |
| Notepad raw payload   | —        | —       | NOT RUN | —                |
| Enter suffix          | —        | —       | NOT RUN | —                |
| 100 consecutive scans | —        | —       | NOT RUN | —                |

## UAT ZD220 + QZ Tray

1. Install QZ Tray dari distribusi yang disetujui IT.
2. Catat versi dan pastikan QZ berjalan pada user Windows operator.
3. Catat exact printer name dari Windows. Tidak ada mapping printer per
   workstation di server — operator memilih printer dari dropdown QZ Tray
   setiap mulai sesi (Phase 7); jangan menggunakan printer pertama sebagai
   fallback default.
4. Ukur media, pilih sensing mode yang benar, kalibrasi, lalu kirim raw ZPL
   minimal yang mencetak border, garis ukur, dan teks identitas test.
5. Ukur output fisik; catat clipping, offset, darkness, speed, orientation,
   gap/black-mark, dan hasil feed beberapa label.

| Test                           | Operator | Tanggal    | Hasil   | Evidence/catatan                       |
| ------------------------------ | -------- | ---------- | ------- | -------------------------------------- |
| QZ installed                   | Rendy    | 2026-07-13 | PASS    | Folder instalasi QZ Tray terdeteksi    |
| QZ connected                   | —        | —          | NOT RUN | Proses QZ tidak aktif saat pemeriksaan |
| Exact mapped printer found     | —        | —          | NOT RUN | —                                      |
| Raw ZPL manual print           | —        | —          | NOT RUN | —                                      |
| Physical dimensions/media feed | —        | —          | NOT RUN | —                                      |

## Signing strategy

### Development

- Gunakan certificate development terpisah.
- Dialog/warning diperbolehkan hanya pada environment developer.
- Jangan commit private key; simpan di secret store/environment server-side.

### Production

- Gunakan QZ trusted certificate untuk silent printing atau company-managed
  root certificate yang telah disetujui IT.
- Signing dilakukan server-side dengan SHA-512; private key tidak pernah dikirim
  ke browser.
- Public certificate boleh diberikan melalui endpoint certificate.
- Endpoint signing wajib authenticated, origin-allowlisted, rate-limited, dan
  tidak mencatat payload/private key.
- Renewal owner dan expiry alert harus ditetapkan sebelum go-live.

Status strategi: `PROPOSED — IT/SECURITY AND LICENSING APPROVAL REQUIRED`.

## Referensi vendor

- QZ Tray: Using QZ Tray, Signing Examples, dan Generate Certificate.
- Zebra: ZD220 Technical Specifications / Specification Sheet.
- Zebra: DS2208 Product Reference Guide dan 123Scan untuk konfigurasi/troubleshooting.
