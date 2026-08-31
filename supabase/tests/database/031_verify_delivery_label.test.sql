-- Verifikasi Pengiriman, Bagian 2: baris lunas ketika jumlah Qty yang discan
-- mencapai Qty Delivery.
-- Spec: docs/superpowers/specs/2026-08-21-verifikasi-pengiriman-design.md
--
-- Label membawa Qty box yang dipegang. Operator menembak box demi box dan
-- angkanya dijumlahkan; berapa box yang dipakai tidak diatur. Kiriman 5000
-- boleh datang sebagai 2500+2500 maupun 3000+1500+500.
--
-- File ini sengaja tidak menyentuh master_items, boxes, label_box_batches,
-- label_boxes, maupun mpq_sheet_rows.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(25);

create temporary table verify_seq_before as
select last_value, is_called from public.delivery_verification_session_seq;

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91310000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
  'verify-delivery@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '91310000-0000-0000-0000-000000000001', 'Verify Delivery', 'admin', true
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91310000-0000-0000-0000-000000000001',
  true
);

create temporary table vd_session as
select * from public.create_delivery_verification_session();
grant select on vd_session to public;

-- Baris A kiriman 5000, baris B 2000, baris C berspasi di jadwal dan rapat di
-- labelnya. Ketiganya berdampingan supaya satu scan tidak bisa "menemukan"
-- baris lain yang kebetulan cocok.
select public.add_delivery_schedule_rows(
  (select id from vd_session),
  'jadwal-vd.xlsx',
  '[{"customer": "PT. UJI SEJAHTERA", "doDate": "2026-08-21",
     "productSize": "UJI-A T1XW1 L=10MM", "qty": "5000"},
    {"customer": "PT. UJI SEJAHTERA", "doDate": "2026-08-21",
     "productSize": "UJI-B T1XW1 L=20MM", "qty": "2000"},
    {"customer": "PT. UJI LAINNYA", "doDate": "bukan tanggal",
     "productSize": "  uji-c   T1XW1 L=30MM ", "qty": "500"}]'::jsonb
);

select is(
  (
    select do_date::text from public.delivery_schedule_rows
    where session_id = (select id from vd_session) and row_no = 1
  ),
  '2026-08-21',
  'DO Date tersimpan dari dokumen'
);

-- Tanggal yang tidak terbaca disimpan kosong, bukan menggagalkan filenya: ia
-- cuma keterangan di kartu session.
select is(
  (
    select do_date from public.delivery_schedule_rows
    where session_id = (select id from vd_session) and row_no = 3
  ),
  null::date,
  'tanggal yang tidak berbentuk YYYY-MM-DD disimpan kosong'
);

select is(
  (
    select customer from public.delivery_schedule_rows
    where session_id = (select id from vd_session) and row_no = 3
  ),
  'PT. UJI LAINNYA',
  'Customer disimpan per baris: satu file memuat beberapa customer sekaligus'
);

select is(
  (
    select verified_qty from public.delivery_schedule_rows
    where session_id = (select id from vd_session) and row_no = 1
  ),
  0,
  'baris hasil upload belum punya keping terverifikasi'
);

-- Baris A: 5000 datang sebagai 2000 + 2500 + 500. Jumlah box tidak diatur.
create temporary table vd_a1 as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-A T1XW1 L=10MM|2000|DBT-512|24-AUG-2026'
);
grant select on vd_a1 to public;

select is(
  (select result from vd_a1)::text,
  'pass',
  'box pertama diterima meski Qty-nya bukan seluruh kiriman'
);

select is(
  (select verified_qty from vd_a1),
  2000,
  'kepingnya dijumlahkan, bukan dihitung sebagai satu box penuh'
);

select is(
  (select remaining_qty from vd_a1),
  3000,
  'sisanya dilaporkan supaya operator tahu berapa lagi'
);

select is(
  (select row_done from vd_a1),
  false,
  'baris belum lunas selama totalnya belum mencapai Qty Delivery'
);

-- Qty yang melebihi sisa ditolak. Menerimanya berarti kiriman tercatat lebih
-- banyak daripada yang dijadwalkan.
create temporary table vd_a_over as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-A T1XW1 L=10MM|4000|DBT-512|24-AUG-2026'
);
grant select on vd_a_over to public;

select is(
  (select result from vd_a_over)::text,
  'not_pass',
  'Qty yang melebihi sisa ditolak'
);

select is(
  (select remaining_qty from vd_a_over),
  3000,
  'penolakannya menyebut sisa yang sebenarnya'
);

select is(
  (
    select verified_qty from public.delivery_schedule_rows
    where session_id = (select id from vd_session) and row_no = 1
  ),
  2000,
  'scan yang ditolak tidak menambah apa pun'
);

select public.verify_delivery_label(
  (select id from vd_session), '10015|UJI-A T1XW1 L=10MM|2500|DBT-512|24-AUG-2026'
);

create temporary table vd_a3 as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-A T1XW1 L=10MM|500|DBT-512|24-AUG-2026'
);
grant select on vd_a3 to public;

select is(
  (select row_done from vd_a3),
  true,
  '2000 + 2500 + 500 melunasi kiriman 5000'
);

select is(
  (select verified_boxes from vd_a3),
  3,
  'jumlah box dihitung dari scan yang diterima, bukan diketik'
);

select is(
  (select remaining_qty from vd_a3),
  0,
  'tidak ada sisa setelah baris lunas'
);

-- Box berlebih untuk baris yang sudah lengkap dibedakan dari Qty yang
-- kebesaran: operator perlu tahu kiriman ini sudah cukup.
create temporary table vd_a4 as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-A T1XW1 L=10MM|500|DBT-512|24-AUG-2026'
);
grant select on vd_a4 to public;

select is(
  (select result from vd_a4)::text,
  'not_pass',
  'box berlebih ditolak setelah barisnya lengkap'
);

select is(
  (select size_complete from vd_a4),
  true,
  'penolakannya menyebut bahwa ukuran ini sudah lengkap'
);

-- Baris B: satu box yang persis sebesar kirimannya tetap sah.
create temporary table vd_b as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-B T1XW1 L=20MM|2000|DBT-512|24-AUG-2026'
);
grant select on vd_b to public;

select is(
  (select row_done from vd_b),
  true,
  'satu box sebesar kirimannya melunasi barisnya sekali tembak'
);

select is(
  (select verified_boxes from vd_b),
  1,
  'satu box tercatat'
);

select is(
  (select delivery_ok from vd_b),
  false,
  'baris ketiga belum discan, jadi belum DELIVERY OK'
);

-- Diuji selagi session masih terbuka: session yang sudah selesai menolak scan
-- lebih dulu, jadi payload rusak pun tidak sampai ke pembacaan QR-nya.
select is(
  (
    select result::text from public.verify_delivery_label(
      (select id from vd_session), '10015|UJI-A T1XW1 L=10MM'
    )
  ),
  'unknown_label',
  'payload kurang dari tiga field tetap dilaporkan sebagai QR tak terbaca'
);

select is(
  (
    select result::text from public.verify_delivery_label(
      (select id from vd_session),
      '10015|TIDAK-DIJADWALKAN T9XW9 L=99MM|100|DBT-512|24-AUG-2026'
    )
  ),
  'not_pass',
  'ukuran yang tidak ada di jadwal ditolak'
);

-- Baris C: jadwal berspasi, label rapat.
create temporary table vd_c as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-C T1XW1 L=30MM|500|DBT-512|24-AUG-2026'
);
grant select on vd_c to public;

select is(
  (select delivery_ok from vd_c),
  true,
  'box terakhir menutup seluruh jadwal: DELIVERY OK'
);

select is(
  (select total_count from vd_c),
  7500,
  'hitungannya keping, bukan box: 5000 + 2000 + 500'
);

select is(
  (select verified_count from vd_c),
  7500,
  'seluruh keping yang dijadwalkan sudah masuk'
);

select is(
  (
    select status::text from public.delivery_verification_sessions
    where id = (select id from vd_session)
  ),
  'done',
  'session ikut selesai pada box terakhir'
);

reset role;

select setval(
  'public.delivery_verification_session_seq',
  (select last_value from verify_seq_before),
  (select is_called from verify_seq_before)
);

select * from finish();

rollback;
