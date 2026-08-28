-- MPQ Sheet: daftar rujukan yang boleh disunting admin.
--
-- Yang dijaga file ini tiga hal. Pertama, tulisnya hanya lewat RPC: PostgREST
-- tidak pernah diberi grant tulis, dan kalau suatu saat ada yang memberinya --
-- atau menambah policy insert -- tes ini yang gagal lebih dulu. Kedua, isi
-- dokumen "MPQ SHEET CRT 2021" masuk utuh 93 baris, hanya ukuran sheet, tanpa
-- selang yang sempat ikut terbawa daftar CRT lengkap. Ketiga, keempat RPC-nya
-- khusus admin dan menolak ukuran kembar.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(29);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('93300000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'mpq-active@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('93300000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'mpq-inactive@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('93300000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'mpq-operator@example.test', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, display_name, role, is_active) values
  ('93300000-0000-0000-0000-000000000001', 'MPQ Active', 'admin', true),
  ('93300000-0000-0000-0000-000000000002', 'MPQ Inactive', 'user', false),
  -- Aktif tetapi bukan admin: yang membedakan "boleh membaca" dari "boleh
  -- menyunting" harus diuji oleh seseorang yang punya yang pertama saja.
  ('93300000-0000-0000-0000-000000000003', 'MPQ Operator', 'user', true);

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

-- Menyunting daftar: khusus admin, lewat RPC.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '93300000-0000-0000-0000-000000000003', true
);

select throws_ok(
  $$ select public.create_mpq_sheet_row('UJI-CRUD T1XW1 L=1MM', 500, 'PCS/BOX') $$,
  'P0001', 'MPQ_ADMIN_REQUIRED',
  'pengguna aktif yang bukan admin tidak boleh menambah ukuran'
);

select throws_ok(
  $$ select public.delete_mpq_sheet_row(
       (select id from public.mpq_sheet_rows where row_no = 1)
     ) $$,
  'P0001', 'MPQ_ADMIN_REQUIRED',
  'pengguna aktif yang bukan admin tidak boleh menghapus ukuran'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '93300000-0000-0000-0000-000000000001', true
);

create temporary table mpq_new as
select * from public.create_mpq_sheet_row('  uji-crud   t1xw1 L=1MM ', 500, 'pcs/box');
grant select on mpq_new to public;

select is(
  (select product_size from mpq_new),
  'UJI-CRUD T1XW1 L=1MM',
  'ukuran disimpan huruf besar dengan spasi dirapikan'
);

select is(
  (select unit from mpq_new),
  'PCS/BOX',
  'satuan ikut dibakukan huruf besar'
);

select is(
  (select row_no from mpq_new),
  94,
  'nomor urut melanjutkan baris terakhir dokumen'
);

select is(
  (select is_active from mpq_new),
  true,
  'ukuran baru langsung aktif'
);

-- Ejaan berspasi berbeda tetap satu ukuran, dan pesannya harus terbaca operator
-- sebagai duplikat, bukan sebagai galat Postgres mentah.
select throws_ok(
  $$ select public.create_mpq_sheet_row('UJI-CRUD T1XW1 L=1 MM', 700, 'PCS/BOX') $$,
  'P0001', 'MPQ_SIZE_EXISTS',
  'ukuran kembar ditolak dengan sebab yang bisa dibaca'
);

select throws_ok(
  $$ select public.create_mpq_sheet_row('UJI-NOL T1XW1 L=1MM', 0, 'PCS/BOX') $$,
  'P0001', 'MPQ_INPUT_INVALID',
  'MPQ nol ditolak'
);

select is(
  (
    select mpq_qty from public.update_mpq_sheet_row(
      (select id from mpq_new), 'UJI-CRUD T1XW1 L=1MM', 750, 'PCS/BOX'
    )
  ),
  750,
  'MPQ bisa diperbaiki tanpa membuat baris baru'
);

select is(
  (
    select row_no from public.mpq_sheet_rows
    where id = (select id from mpq_new)
  ),
  94,
  'menyunting tidak memindahkan barisnya di daftar'
);

select is(
  (
    select is_active from public.set_mpq_sheet_row_active(
      (select id from mpq_new), false
    )
  ),
  false,
  'ukuran bisa dinonaktifkan tanpa dihapus'
);

select lives_ok(
  $$ select public.delete_mpq_sheet_row((select id from mpq_new)) $$,
  'ukuran bisa dibuang seluruhnya'
);

select is(
  (select count(*)::integer from public.mpq_sheet_rows),
  93,
  'daftarnya kembali seperti semula sesudah baris ujinya dibuang'
);

reset role;

select * from finish();

rollback;
