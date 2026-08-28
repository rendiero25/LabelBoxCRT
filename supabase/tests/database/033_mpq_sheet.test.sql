-- MPQ Sheet: daftar rujukan, bukan data yang tumbuh di aplikasi.
--
-- Yang dijaga file ini dua hal. Pertama, tabelnya benar-benar hanya bisa
-- dibaca: kalau suatu saat ada yang memberi grant tulis atau menambah policy
-- insert, tes ini yang gagal lebih dulu. Kedua, isinya utuh 93 baris seperti
-- dokumen "MPQ SHEET CRT 2021" setelah baris kembarnya dibuang -- dan hanya
-- ukuran sheet, tanpa selang yang sempat ikut terbawa daftar CRT lengkap.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(16);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('93300000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'mpq-active@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('93300000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'mpq-inactive@example.test', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, display_name, role, is_active) values
  ('93300000-0000-0000-0000-000000000001', 'MPQ Active', 'admin', true),
  ('93300000-0000-0000-0000-000000000002', 'MPQ Inactive', 'user', false);

select has_table('public', 'mpq_sheet_rows', 'tabel mpq_sheet_rows ada');

select is(
  (
    select relrowsecurity from pg_catalog.pg_class
    where oid = 'public.mpq_sheet_rows'::regclass
  ),
  true,
  'RLS menyala'
);

select is(
  (
    select relforcerowsecurity from pg_catalog.pg_class
    where oid = 'public.mpq_sheet_rows'::regclass
  ),
  true,
  'RLS dipaksa, pemilik tabel pun tidak lewat begitu saja'
);

-- Satu-satunya hak yang boleh dipunyai authenticated adalah SELECT. Ditulis
-- sebagai satu daftar, bukan tiga tes terpisah, supaya grant tulis apa pun yang
-- ditambahkan kelak langsung terbaca di pesan gagalnya.
select is(
  (
    select coalesce(
      array_agg(privilege_type::text order by privilege_type::text), '{}'::text[]
    )
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'mpq_sheet_rows'
      and grantee = 'authenticated'
  ),
  array['SELECT'],
  'authenticated hanya boleh membaca'
);

select is(
  (
    select coalesce(array_agg(cmd::text order by policyname), '{}'::text[])
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'mpq_sheet_rows'
  ),
  array['SELECT'],
  'tidak ada policy selain baca'
);

set local role anon;
select throws_ok(
  $$ select count(*) from public.mpq_sheet_rows $$,
  '42501',
  null,
  'anon tidak bisa membaca MPQ Sheet'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '93300000-0000-0000-0000-000000000002', true
);
select is(
  (select count(*)::integer from public.mpq_sheet_rows),
  0,
  'profil nonaktif tidak melihat satu baris pun'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '93300000-0000-0000-0000-000000000001', true
);

select is(
  (select count(*)::integer from public.mpq_sheet_rows),
  93,
  'dokumen MPQ Sheet masuk utuh: 111 baris excel, 93 ukuran unik'
);

select is(
  (select max(row_no)::integer from public.mpq_sheet_rows),
  93,
  'nomor urut berhenti tepat di baris terakhir'
);

select is(
  (select count(distinct row_no)::integer from public.mpq_sheet_rows),
  93,
  'nomor urut tidak ada yang kembar, jadi 1..93 tanpa bolong'
);

-- Daftar CRT lengkap yang sempat termuat juga berisi selang CVO/VO/EL067 dan
-- satuan PCS/LAKBAN. MPQ Sheet hanya soal lembaran, jadi keduanya harus habis;
-- baris selang yang tertinggal berarti daftar lama tidak benar-benar terhapus.
select is(
  (
    select array_agg(distinct unit order by unit)
    from public.mpq_sheet_rows
  ),
  array['PCS/BOX'],
  'hanya satuan sheet yang tersisa, PCS/LAKBAN sudah tidak ada'
);

select is(
  (
    select count(*)::integer from public.mpq_sheet_rows
    where product_size not like 'VS-B %'
  ),
  0,
  'tidak ada ukuran selain sheet VS-B'
);

-- Ukuran yang dipakai halaman Verifikasi Pengiriman. MPQ-nya 2000, angka yang
-- sama dengan Qty di jadwal contoh -- itulah gunanya daftar ini.
select is(
  (
    select mpq_qty from public.mpq_sheet_rows
    where product_size = 'VS-B T0.3XW100 L=120MM'
  ),
  2000,
  'MPQ terbaca untuk ukuran yang dipakai verifikasi pengiriman'
);

-- Baris terakhir dokumen ditulis berspasi ('L=60 MM'). Yang dicari lewat
-- kuncinya adalah ejaan rapat seperti yang ditulis label.
select is(
  (
    select product_size from public.mpq_sheet_rows
    where product_size_key = 'VS-BT0.5XW60L=60MM'
  ),
  'VS-B T0.5XW60 L=60 MM',
  'ukuran berspasi tetap ketemu lewat kunci tanpa spasi'
);

select is(
  (select count(*)::integer from public.mpq_sheet_rows where mpq_qty <= 0),
  0,
  'tidak ada MPQ nol atau negatif'
);

reset role;

-- Dua ejaan ukuran yang hanya beda spasi adalah satu ukuran, dan yang kedua
-- harus ditolak. Tanpa ini, satu ukuran bisa punya dua MPQ berbeda dan tidak
-- ada cara memilih yang benar.
select throws_ok(
  $$
    insert into public.mpq_sheet_rows (row_no, product_size, mpq_qty, unit)
    values (9001, 'VS-B T0.5XW60 L=60MM', 1234, 'PCS/BOX')
  $$,
  '23505',
  null,
  'ukuran yang sama dengan spasi berbeda ditolak sebagai duplikat'
);

select * from finish();

rollback;
