-- Membuang session verifikasi pengiriman beserta isinya.
--
-- Yang diuji: barisnya benar-benar ikut pergi lewat cascade, dan ringkasannya
-- tetap tertinggal di audit_logs -- sebab yang terhapus di sini bukan cuma
-- sessionnya melainkan seluruh bukti pemeriksaannya.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(6);

create temporary table delete_seq_before as
select last_value, is_called from public.delivery_verification_session_seq;

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91320000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
  'delete-session@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '91320000-0000-0000-0000-000000000001', 'Delete Session', 'user', true
);

-- Jadwal hanya menerima ukuran yang punya MPQ sejak 20260828025319.
insert into public.mpq_sheet_rows (row_no, product_size, mpq_qty, unit) values
  (9201, 'HAPUS-A T1XW2 L=3MM', 100, 'PCS/BOX'),
  (9202, 'HAPUS-B T1XW2 L=4MM', 200, 'PCS/BOX');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91320000-0000-0000-0000-000000000001',
  true
);

create temporary table ds_session as
select * from public.create_delivery_verification_session();
grant select on ds_session to public;

select public.add_delivery_schedule_rows(
  (select id from ds_session),
  'jadwal-hapus.xlsx',
  '[{"productSize": "HAPUS-A T1XW2 L=3MM", "qty": "100"},
    {"productSize": "HAPUS-B T1XW2 L=4MM", "qty": "200"}]'::jsonb
);

select is(
  (
    select count(*)::integer from public.delivery_schedule_rows
    where session_id = (select id from ds_session)
  ),
  2,
  'session punya dua baris jadwal sebelum dihapus'
);

select lives_ok(
  $$
    select public.delete_delivery_verification_session(
      (select id from ds_session)
    )
  $$,
  'session bisa dihapus'
);

select is(
  (
    select count(*)::integer from public.delivery_verification_sessions
    where id = (select id from ds_session)
  ),
  0,
  'sessionnya hilang'
);

-- Cascade, bukan yatim: baris jadwal yang tertinggal tanpa session tidak bisa
-- dibuka dari mana pun dan tidak akan pernah dibersihkan.
select is(
  (
    select count(*)::integer from public.delivery_schedule_rows
    where session_id = (select id from ds_session)
  ),
  0,
  'baris jadwalnya ikut terhapus'
);

select throws_ok(
  $$
    select public.delete_delivery_verification_session(
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  $$,
  'P0001', 'DELIVERY_SESSION_NOT_FOUND',
  'session yang tidak ada ditolak dengan kode sendiri'
);

reset role;

-- Dibaca setelah reset role: audit_logs tertutup bagi pembaca non-admin, dan
-- operator yang menghapus session memang bukan admin.
select is(
  (
    select (metadata ->> 'row_count')::integer from public.audit_logs
    where action = 'delivery_verification_session.deleted'
      and entity_id = (select id from ds_session)::text
  ),
  2,
  'audit log menyimpan berapa baris yang ikut terbuang'
);

select setval(
  'public.delivery_verification_session_seq',
  (select last_value from delete_seq_before),
  (select is_called from delete_seq_before)
);

select * from finish();

rollback;
