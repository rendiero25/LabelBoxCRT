-- Singkatan bulan pada tanggal label dan QR pindah ke ejaan Inggris.
--
-- Kirimannya dibaca juga oleh pihak di luar pabrik, dan "AGS"/"OKT"/"DES"
-- hanya terbaca oleh yang tahu bahasa Indonesia. Empat bulan yang berubah:
-- MEI jadi MAY, AGS jadi AUG, OKT jadi OCT, DES jadi DEC.
--
-- Pemetaannya tetap ditulis tangan, tidak diserahkan ke to_char(..., 'MON'):
-- keluaran to_char ikut lc_time server, jadi hasilnya bisa berbeda antar
-- lingkungan tanpa ada yang mengubah kode apa pun.
--
-- Baris label_boxes yang sudah ada tidak ditulis ulang, sama seperti waktu
-- bentuk payloadnya berubah: sebagian labelnya sudah tercetak dan menempel di
-- box, dan payload di database harus tetap sama dengan QR yang tertempel.
-- Batch lama memakai ejaan baru begitu ia disunting.

create or replace function private.label_date_text(p_date date)
returns text
language sql
immutable
set search_path to 'pg_catalog'
as $function$
  select to_char(p_date, 'DD') || '-' ||
    case extract(month from p_date)::integer
      when 1 then 'JAN'
      when 2 then 'FEB'
      when 3 then 'MAR'
      when 4 then 'APR'
      when 5 then 'MAY'
      when 6 then 'JUN'
      when 7 then 'JUL'
      when 8 then 'AUG'
      when 9 then 'SEP'
      when 10 then 'OCT'
      when 11 then 'NOV'
      when 12 then 'DEC'
    end || '-' || to_char(p_date, 'YYYY')
$function$;

notify pgrst, 'reload schema';
