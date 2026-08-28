-- Verifikasi Pengiriman, Bagian 1: session dan Schedule Delivery.
-- Spec: docs/superpowers/specs/2026-08-21-verifikasi-pengiriman-design.md

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(15);

-- nextval() tidak ikut rollback, jadi tiap kali file ini dijalankan ia membakar
-- satu nomor session dan session nyata berikutnya melompat. Nilai aslinya
-- ditangkap di sini dan dikembalikan setelah `reset role` di bawah.
create temporary table delivery_session_seq_before as
select last_value, is_called from public.delivery_verification_session_seq;

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('91300000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
    'delivery-verif@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('91300000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
    'delivery-verif-off@example.test', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, display_name, role, is_active) values
  ('91300000-0000-0000-0000-000000000001', 'Delivery Verifier', 'user', true),
  ('91300000-0000-0000-0000-000000000002', 'Delivery Nonaktif', 'user', false);

-- Sejak 20260828025319 jadwal hanya menerima ukuran yang punya MPQ: jumlah box
-- yang harus discan diturunkan dari sana. Ukuran uji di file ini karena itu
-- perlu barisnya sendiri di MPQ Sheet.
insert into public.mpq_sheet_rows (row_no, product_size, mpq_qty, unit) values
  (9101, 'QRPQ-PART', 5000, 'PCS/BOX'),
  (9102, 'LAIN-PART', 300, 'PCS/BOX'),
  (9103, 'ADA', 10, 'PCS/BOX');

select has_table(
  'public', 'delivery_verification_sessions',
  'delivery_verification_sessions table exists'
);
select has_table(
  'public', 'delivery_schedule_rows',
  'delivery_schedule_rows table exists'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91300000-0000-0000-0000-000000000001',
  true
);

create temporary table verif_session as
select * from public.create_delivery_verification_session();
grant select on verif_session to public;

select is(
  (select status from verif_session)::text,
  'open',
  'session baru berstatus open'
);

select isnt(
  (select session_no from verif_session),
  null,
  'session baru mendapat nomor urut tanpa isian apa pun'
);

-- Satu file boleh memuat satu baris maupun banyak; keduanya masuk lewat satu
-- panggilan supaya file yang gagal di tengah tidak meninggalkan jadwal yang
-- tidak sesuai dokumen mana pun.
select is(
  (
    select count(*)::integer from public.add_delivery_schedule_rows(
      (select id from verif_session),
      'jadwal-a.xlsx',
      '[{"productSize": "QRPQ-PART", "qty": "5000"},
        {"productSize": "lain-part", "qty": "300"}]'::jsonb
    )
  ),
  2,
  'satu file dengan dua baris masuk dua-duanya'
);

select is(
  (
    select string_agg(product_size, ',' order by row_no)
    from public.delivery_schedule_rows
    where session_id = (select id from verif_session)
  ),
  'QRPQ-PART,LAIN-PART',
  'part no disimpan huruf besar dengan spasi dirapikan'
);

-- Upload kedua menambah di bawah, bukan memulai lagi dari 1.
select lives_ok(
  $$
    select public.add_delivery_schedule_rows(
      (select id from verif_session),
      'jadwal-b.xlsx',
      '[{"productSize": "QRPQ-PART", "qty": "7000"}]'::jsonb
    )
  $$,
  'file kedua bisa diunggah ke session yang sama'
);

select is(
  (
    select string_agg(row_no::text, ',' order by row_no)
    from public.delivery_schedule_rows
    where session_id = (select id from verif_session)
  ),
  '1,2,3',
  'nomor baris berlanjut lintas upload'
);

-- Part No kembar dengan Qty berbeda adalah dua kiriman, bukan satu yang
-- ditimpa: masing-masing perlu satu label yang cocok.
select is(
  (
    select string_agg(qty_delivery::text, ',' order by row_no)
    from public.delivery_schedule_rows
    where session_id = (select id from verif_session)
      and product_size = 'QRPQ-PART'
  ),
  '5000,7000',
  'part no kembar berdiri sebagai dua baris dengan qty masing-masing'
);

select is(
  (
    select source_file_name from public.delivery_schedule_rows
    where session_id = (select id from verif_session) and row_no = 3
  ),
  'jadwal-b.xlsx',
  'tiap baris ingat file yang memasukkannya'
);

select is(
  (
    select count(*)::integer from public.delivery_schedule_rows
    where session_id = (select id from verif_session) and verified_at is not null
  ),
  0,
  'baris jadwal belum terverifikasi sampai Bagian 2 mengisinya'
);

-- File yang tidak menghasilkan satu pun baris ditolak. Tabel yang tidak
-- bertambah setelah upload terbaca sebagai aplikasi yang menggantung.
select throws_ok(
  $$
    select public.add_delivery_schedule_rows(
      (select id from verif_session), 'kosong.xlsx', '[]'::jsonb
    )
  $$,
  'P0001', 'DELIVERY_ROWS_EMPTY',
  'file tanpa baris terbaca ditolak, bukan diterima diam-diam'
);

select throws_ok(
  $$
    select public.add_delivery_schedule_rows(
      (select id from verif_session),
      'rusak.xlsx',
      '[{"productSize": "", "qty": "10"}]'::jsonb
    )
  $$,
  'P0001', 'DELIVERY_ROWS_INVALID',
  'baris tanpa part no ditolak'
);

select throws_ok(
  $$
    select public.add_delivery_schedule_rows(
      (select id from verif_session),
      'rusak.xlsx',
      '[{"productSize": "ADA", "qty": "0"}]'::jsonb
    )
  $$,
  'P0001', 'DELIVERY_ROWS_INVALID',
  'qty nol ditolak'
);

select lives_ok(
  $$
    select public.delete_delivery_schedule_row(
      (
        select id from public.delivery_schedule_rows
        where session_id = (select id from verif_session) and row_no = 3
      )
    )
  $$,
  'baris hasil upload yang salah bisa dibuang'
);

reset role;

select setval(
  'public.delivery_verification_session_seq',
  (select last_value from delivery_session_seq_before),
  (select is_called from delivery_session_seq_before)
);

select * from finish();

rollback;
