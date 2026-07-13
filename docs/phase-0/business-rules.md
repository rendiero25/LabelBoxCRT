# Business Decision Register

Status `APPROVED` berasal dari jawaban owner tanggal 13 Juli 2026. Status
`PARTIAL` atau `OPEN` belum boleh menjadi invariant database.

| ID    | Keputusan                   | Rekomendasi                                                                                                                                                      | Alasan                                                                                          | Status   |
| ----- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------- |
| BR-01 | Arti “3 produk/5 produk”    | Quantity unit per layer box, bukan jumlah jenis.                                                                                                                 | Dikonfirmasi owner.                                                                             | APPROVED |
| BR-02 | Nama Box                    | Field alfanumerik dan disnapshot ke print job.                                                                                                                   | Dikonfirmasi owner; format tampilan gabungan dengan code belum diperlukan untuk mengunci field. | APPROVED |
| BR-03 | No Urut Item                | Field alfanumerik bersumber dari Data Master Item. Formula contoh `1-180526-B101` masih perlu dijelaskan karena tampak tersusun dari sequence, tanggal, dan box. | Source dan tipe dikonfirmasi; formula belum konsisten.                                          | PARTIAL  |
| BR-04 | Sequence scope              | Belum ditetapkan.                                                                                                                                                | Diperlukan sebelum membuat counter/unique constraint.                                           | OPEN     |
| BR-05 | Sumber tanggal label        | `delivery_numbers.delivery_date`, disimpan sebagai `date`, ditampilkan `dd-MMMM-yyyy` berbahasa Inggris, contoh `13-July-2026`.                                  | Dikonfirmasi owner.                                                                             | APPROVED |
| BR-06 | Koreksi contoh tanggal      | Belum terselesaikan: `1-180526-B101` mengandung 18 Mei 2026 sedangkan contoh tanggal label `15-mei-2026`.                                                        | Dua nilai tanggal tidak boleh dianggap sama.                                                    | OPEN     |
| BR-07 | Urutan field label box      | Supplier Code → Part No → Qty → No Urut Item → Delivery Number → Nama Box → Tanggal Delivery. DN dipilih setelah semua scan valid.                               | Dikonfirmasi owner.                                                                             | APPROVED |
| BR-08 | Qty 100                     | Default 100 adalah data konfigurasi pada Master Item, bukan constant aplikasi; nilai final disnapshot ke print job.                                              | Memenuhi kebutuhan owner tanpa hard-code.                                                       | APPROVED |
| BR-09 | Sumber supplier             | `supplier_code` berasal dari `suppliers`; Delivery Number berasal dari `delivery_numbers` dan wajib mereferensikan supplier yang sama.                           | Menjaga relasi dan mencegah cross-supplier.                                                     | APPROVED |
| BR-10 | Cancel/reset                | Cancel hanya untuk session sebelum finalisasi, wajib reason dan audit; scan tidak dihapus. Reset membuat session baru melalui workflow supervisor.               | Histori tetap append-oriented dan tidak ada silent reuse.                                       | PROPOSED |
| BR-11 | Physical print confirmation | Pertahankan state `sent_to_printer`, lalu operator mengonfirmasi `confirmed`; timeout masuk review, bukan auto-reprint.                                          | `qz.print()` tidak membuktikan label keluar secara fisik.                                       | PROPOSED |
| BR-12 | Retention                   | Audit 7 tahun; session/scan/print 2 tahun online lalu archive; raw diagnostic QR maksimal 30 hari. Legal/IT wajib mengoreksi bila kebijakan perusahaan berbeda.  | Baseline konservatif tanpa menghapus audit secara normal.                                       | PROPOSED |
| BR-13 | Notifikasi UI               | Gunakan toast Sonner dari shadcn untuk notifikasi non-blocking. Status scan utama tetap tampil permanen dan tidak hanya bergantung pada toast.                   | Dikonfirmasi owner dan mengikuti aturan operator screen.                                        | APPROVED |
| BR-14 | Typography                  | Gunakan Google Font Outfit.                                                                                                                                      | Dikonfirmasi owner.                                                                             | APPROVED |

## Konsekuensi yang perlu disetujui

- BR-03/BR-04/BR-06 menentukan format reference, unique constraint, dan perilaku reset counter.
- BR-08 menentukan sumber `Qty` pada label, bukan quantity scan per layer.
- BR-10 memerlukan correction/release workflow agar komponen fisik dari session
  cancelled tidak terkunci selamanya tanpa otorisasi.
- BR-12 adalah kebijakan operasional, bukan nasihat kepatuhan; Legal/IT menjadi
  approver final.

## Approval

| Peran                    | Nama | Tanggal | Keputusan/catatan |
| ------------------------ | ---- | ------- | ----------------- |
| Business owner           | —    | —       | Pending           |
| Production/process owner | —    | —       | Pending           |
| IT/security              | —    | —       | Pending           |

## Snapshot label box yang disetujui

| Field            | Sumber                                                    |
| ---------------- | --------------------------------------------------------- |
| Supplier Code    | `suppliers.code` melalui supplier Delivery Number         |
| Part No          | Data Master Item                                          |
| Qty              | Default Master Item, nilai awal 100                       |
| No Urut Item     | Field alfanumerik Data Master Item; formula final pending |
| Delivery Number  | `delivery_numbers`, dipilih setelah seluruh scan valid    |
| Nama Box         | Box definition, alfanumerik                               |
| Tanggal Delivery | `delivery_numbers.delivery_date`, display `dd-MMMM-yyyy`  |
