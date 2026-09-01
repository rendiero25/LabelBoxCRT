-- Mengisi DO Date jadwal yang diunggah sebelum kolomnya ada.
--
-- `20260831082847` menambahkan do_date, tetapi seluruh jadwal yang sudah
-- terlanjur masuk bernilai null -- kolomnya lahir sesudah mereka diunggah.
-- Kartu session karena itu tidak menyebutkan tanggal DO satu pun, dan
-- mengunggah ulang bukan jalan keluar: barisnya akan bertambah, bukan
-- terganti, dan hasil scan yang sudah ada ikut hilang bersama sessionnya.
--
-- Tanggalnya tidak ditebak dari nama file. Ia dibaca dari dokumen aslinya:
--
--   DO Report (21 Aug 2026-21 Aug 2026) CIPTA MANDIRI.xlsx -> 13 baris sheet,
--     seluruhnya ber-DO Date 2026-08-21
--   DO Report (31 Aug 2026) CMW.xlsx -> 12 baris sheet,
--     seluruhnya ber-DO Date 2026-08-31
--
-- Dua session lain, yang barisnya bernama file 'INDOPRIMA.xlsx' dan 'CMW.xlsx',
-- adalah dokumen 21 Agustus yang dipecah per customer: 4 baris + 9 baris, dan
-- pasangan ukuran/Qty-nya cocok persis 13 dari 13 dengan isi file itu. Bukan
-- kemiripan nama, melainkan kesamaan isi.
--
-- Jadwal berformat lama ('DELIVERY *.xlsx') dibiarkan kosong: dokumennya tidak
-- pernah punya kolom DO Date, jadi tidak ada yang bisa dipulihkan. Kartunya
-- akan terus tidak menyebutkan tanggal, dan itu benar.
--
-- Hanya baris ber-do_date null yang disentuh, jadi tidak ada tanggal yang sudah
-- terbaca dari dokumen yang bisa tertimpa.

update public.delivery_schedule_rows
set do_date = '2026-08-21'
where do_date is null
  and source_file_name in (
    'DO Report (21 Aug 2026-21 Aug 2026) CIPTA MANDIRI.xlsx',
    'INDOPRIMA.xlsx',
    'CMW.xlsx'
  );

update public.delivery_schedule_rows
set do_date = '2026-08-31'
where do_date is null
  and source_file_name = 'DO Report (31 Aug 2026) CMW.xlsx';
