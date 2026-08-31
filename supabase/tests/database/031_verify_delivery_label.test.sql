-- Verifikasi Pengiriman, Bagian 2: satu baris jadwal adalah satu kiriman yang
-- dipecah ke beberapa box, dan jumlah box-nya diisi operator.
-- Spec: docs/superpowers/specs/2026-08-21-verifikasi-pengiriman-design.md
--
-- Semua box dari satu baris membawa label yang sama, dan angka di field ketiga
-- QR adalah Qty Delivery -- seluruh jumlah untuk ukuran itu, bukan isi box.
-- Jadi yang dicocokkan Qty Delivery, dan jumlah box menentukan berapa kali
-- label yang sama itu ditembak.
--
-- Jumlah box tidak lagi diturunkan dari MPQ. Yang tahu berapa box sungguh
-- berangkat adalah orang yang mengemasnya; MPQ cuma batas atas, dan box boleh
-- diisi kurang.
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

-- Ukuran ketiga ditulis berspasi di jadwal dan rapat di labelnya nanti, meniru
-- selisih ejaan yang benar-benar ada antara dokumen dan label cetak.
select public.add_delivery_schedule_rows(
  (select id from vd_session),
  'jadwal-vd.xlsx',
  '[{"customer": "PT. UJI SEJAHTERA",
     "productSize": "UJI-A T1XW1 L=10MM", "qty": "8000"},
    {"customer": "PT. UJI SEJAHTERA",
     "productSize": "UJI-B T1XW1 L=20MM", "qty": "2000"},
    {"customer": "PT. UJI LAINNYA",
     "productSize": "  uji-c   T1XW1 L=30MM ", "qty": "500"}]'::jsonb
);

select is(
  (
    select customer from public.delivery_schedule_rows
    where session_id = (select id from vd_session) and row_no = 3
  ),
  'PT. UJI LAINNYA',
  'Customer disimpan per baris: satu file memuat beberapa customer sekaligus'
);

-- Dokumen jadwal tidak menyebut jumlah box, jadi barisnya masuk kosong.
select is(
  (
    select count(*)::integer from public.delivery_schedule_rows
    where session_id = (select id from vd_session) and expected_boxes is null
  ),
  3,
  'baris hasil upload belum punya jumlah box'
);

-- Baris yang Box-nya belum diisi tidak bisa discan sama sekali. Kalau bisa,
-- kiriman sebesar apa pun lunas oleh satu label.
create temporary table vd_unset as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-A T1XW1 L=10MM|8000|DBT-512|24-AUG-2026'
);
grant select on vd_unset to public;

select is(
  (select result from vd_unset)::text,
  'not_pass',
  'scan ditolak selama jumlah box-nya belum diisi'
);

select is(
  (select boxes_unset from vd_unset),
  true,
  'penolakannya menyebut bahwa yang kurang isian di layar, bukan labelnya'
);

select is(
  (
    select expected_boxes from public.set_delivery_schedule_row_boxes(
      (
        select id from public.delivery_schedule_rows
        where session_id = (select id from vd_session) and row_no = 1
      ),
      4
    )
  ),
  4,
  'jumlah box diisi operator'
);

select public.set_delivery_schedule_row_boxes(
  (
    select id from public.delivery_schedule_rows
    where session_id = (select id from vd_session) and row_no = 2
  ),
  2
);
select public.set_delivery_schedule_row_boxes(
  (
    select id from public.delivery_schedule_rows
    where session_id = (select id from vd_session) and row_no = 3
  ),
  1
);

select throws_ok(
  $$
    select public.set_delivery_schedule_row_boxes(
      (
        select id from public.delivery_schedule_rows
        where session_id = (select id from vd_session) and row_no = 1
      ),
      0
    )
  $$,
  'P0001', 'DELIVERY_BOXES_INVALID',
  'nol ditolak: itu bukan "belum diisi", itu baris yang lunas tanpa discan'
);

-- Baris A: empat box, semuanya berlabel 8000.
create temporary table vd_a1 as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-A T1XW1 L=10MM|8000|DBT-512|24-AUG-2026'
);
grant select on vd_a1 to public;

select is(
  (select result from vd_a1)::text,
  'pass',
  'label ber-Qty Delivery diterima sesudah jumlah box diisi'
);

select is(
  (select verified_boxes from vd_a1),
  1,
  'baru satu box dari empat yang masuk'
);

select is(
  (select row_done from vd_a1),
  false,
  'baris belum lunas selama box-nya masih kurang'
);

-- Qty yang bukan Qty Delivery baris mana pun ditolak. Itu yang memisahkan dua
-- kiriman berukuran sama dengan jumlah berbeda.
create temporary table vd_a_wrong as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-A T1XW1 L=10MM|2000|DBT-512|24-AUG-2026'
);
grant select on vd_a_wrong to public;

select is(
  (select result from vd_a_wrong)::text,
  'not_pass',
  'Qty yang bukan Qty Delivery baris itu ditolak walau ukurannya cocok'
);

select is(
  (select expected_qty from vd_a_wrong),
  8000,
  'penolakan menyebut Qty yang seharusnya, bukan NOT PASS belaka'
);

select public.verify_delivery_label(
  (select id from vd_session), '10015|UJI-A T1XW1 L=10MM|8000|DBT-512|24-AUG-2026'
);
select public.verify_delivery_label(
  (select id from vd_session), '10015|UJI-A T1XW1 L=10MM|8000|DBT-512|24-AUG-2026'
);

create temporary table vd_a4 as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-A T1XW1 L=10MM|8000|DBT-512|24-AUG-2026'
);
grant select on vd_a4 to public;

select is(
  (select row_done from vd_a4),
  true,
  'box keempat melunasi barisnya'
);

-- Box kelima untuk baris yang sudah lengkap. Dibedakan dari NOT PASS biasa:
-- operator perlu tahu bahwa yang salah bukan labelnya melainkan bahwa kiriman
-- ini sudah cukup.
create temporary table vd_a5 as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-A T1XW1 L=10MM|8000|DBT-512|24-AUG-2026'
);
grant select on vd_a5 to public;

select is(
  (select size_complete from vd_a5),
  true,
  'box berlebih ditolak dengan sebab "sudah lengkap"'
);

-- Menaikkan jumlah box baris yang sudah lunas membuatnya kurang lagi: operator
-- menemukan satu box lagi di palet, dan barisnya harus terbuka kembali.
select is(
  (
    select verified_at from public.set_delivery_schedule_row_boxes(
      (
        select id from public.delivery_schedule_rows
        where session_id = (select id from vd_session) and row_no = 1
      ),
      5
    )
  ),
  null::timestamptz,
  'menaikkan jumlah box membuka lagi baris yang tadinya lunas'
);

select is(
  (
    select result::text from public.verify_delivery_label(
      (select id from vd_session),
      '10015|UJI-A T1XW1 L=10MM|8000|DBT-512|24-AUG-2026'
    )
  ),
  'pass',
  'box kelima diterima sesudah jumlahnya dinaikkan'
);

-- Menurunkannya di bawah yang sudah discan ditolak: angka itu berarti mengaku
-- telah memeriksa box yang tidak ada.
select throws_ok(
  $$
    select public.set_delivery_schedule_row_boxes(
      (
        select id from public.delivery_schedule_rows
        where session_id = (select id from vd_session) and row_no = 1
      ),
      2
    )
  $$,
  'P0001', 'DELIVERY_BOXES_BELOW_SCANNED',
  'jumlah box tidak boleh turun di bawah box yang sudah discan'
);

-- Baris B: dua box dengan label yang sama persis.
create temporary table vd_b1 as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-B T1XW1 L=20MM|2000|DBT-512|24-AUG-2026'
);
grant select on vd_b1 to public;

select is(
  (select result from vd_b1)::text,
  'pass',
  'baris 2 box menerima label ber-Qty Delivery'
);

create temporary table vd_b2 as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-B T1XW1 L=20MM|2000|DBT-512|24-AUG-2026'
);
grant select on vd_b2 to public;

select is(
  (select row_done from vd_b2),
  true,
  'label yang sama ditembak kedua kalinya melunasi barisnya'
);

select is(
  (select verified_boxes from vd_b2),
  2,
  'kedua box tercatat'
);

select is(
  (select delivery_ok from vd_b2),
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
  8,
  'hitungannya box, bukan baris: 5 + 2 + 1'
);

select is(
  (
    select status::text from public.delivery_verification_sessions
    where id = (select id from vd_session)
  ),
  'done',
  'session ikut selesai pada box terakhir'
);

-- Session yang sudah selesai tidak boleh diubah jumlah box-nya: itu mengubah
-- hasil pemeriksaan yang sudah ditutup.
select throws_ok(
  $$
    select public.set_delivery_schedule_row_boxes(
      (
        select id from public.delivery_schedule_rows
        where session_id = (select id from vd_session) and row_no = 3
      ),
      2
    )
  $$,
  'P0001', 'DELIVERY_SESSION_CLOSED',
  'jumlah box tidak bisa diubah setelah session selesai'
);

reset role;

select setval(
  'public.delivery_verification_session_seq',
  (select last_value from verify_seq_before),
  (select is_called from verify_seq_before)
);

select * from finish();

rollback;
