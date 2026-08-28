-- Verifikasi Pengiriman, Bagian 2: satu baris jadwal adalah satu kiriman yang
-- dipecah ke beberapa box menurut MPQ ukurannya.
-- Spec: docs/superpowers/specs/2026-08-21-verifikasi-pengiriman-design.md
--
-- Semua box dari satu baris membawa label yang sama, dan angka di field ketiga
-- QR adalah Qty Delivery -- seluruh jumlah untuk ukuran itu, bukan isi box.
-- Jadi yang dicocokkan Qty Delivery, dan jumlah box menentukan berapa kali
-- label yang sama itu ditembak.
--
-- Kasus yang dikunci di sini datang dari lantai produksi: Qty Delivery 2000
-- dengan MPQ 1500 adalah 2 box, dan keduanya berlabel 2000. Aturan sebelumnya
-- menuntut 1500 lalu 500 dan menolak label yang sebenarnya -- kekeliruan yang
-- tidak terlihat selama tiap baris kebetulan berjumlah satu box.
--
-- File ini sengaja tidak menyentuh master_items, boxes, label_box_batches,
-- maupun label_boxes: label sheet tidak dibuat aplikasi ini.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(33);

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

-- MPQ dari ukuran uji. Ukuran ketiga ditulis berspasi di sini dan rapat di
-- labelnya nanti, meniru selisih ejaan yang benar-benar ada antara dokumen MPQ
-- dan label cetak.
insert into public.mpq_sheet_rows (row_no, product_size, mpq_qty, unit, is_active)
values
  (9001, 'UJI-A T1XW1 L=10MM', 2000, 'PCS/BOX', true),
  (9002, 'UJI-B T1XW1 L=20MM', 1500, 'PCS/BOX', true),
  (9003, 'UJI-C T1XW1 L=30 MM', 500, 'PCS/BOX', true),
  -- Nonaktif: jadwal baru harus memperlakukannya seperti belum punya MPQ sama
  -- sekali. Tanpa itu menonaktifkan cuma mengubah warna badge.
  (9004, 'UJI-D T1XW1 L=40MM', 400, 'PCS/BOX', false);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91310000-0000-0000-0000-000000000001',
  true
);

create temporary table vd_session as
select * from public.create_delivery_verification_session();
grant select on vd_session to public;

-- Baris A habis dibagi MPQ-nya (4 box), baris B menyisakan (2 box), baris C
-- hanya satu box. Ketiganya berdampingan supaya satu scan tidak bisa
-- "menemukan" baris lain yang kebetulan cocok.
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

select is(
  (
    select expected_boxes from public.delivery_schedule_rows
    where session_id = (select id from vd_session) and row_no = 1
  ),
  4,
  '8000 keping dengan MPQ 2000 berarti 4 box'
);

-- Kasus dari lantai produksi. Sisa 500 tetap minta box sendiri, jadi 2 box,
-- dan keduanya berlabel 2000.
select is(
  (
    select expected_boxes from public.delivery_schedule_rows
    where session_id = (select id from vd_session) and row_no = 2
  ),
  2,
  '2000 keping dengan MPQ 1500 berarti 2 box'
);

select is(
  (
    select mpq_qty from public.delivery_schedule_rows
    where session_id = (select id from vd_session) and row_no = 3
  ),
  500,
  'MPQ disalin ke baris jadwal meski ejaan spasinya berbeda'
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
  'label ber-Qty Delivery diterima sebagai box pertama'
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
  'box keempat melunasi baris 8000 keping'
);

select is(
  (select verified_boxes from vd_a4),
  4,
  'keempat box tercatat'
);

-- Box kelima untuk ukuran yang sudah lengkap. Dibedakan dari NOT PASS biasa:
-- operator perlu tahu bahwa yang salah bukan labelnya melainkan bahwa kiriman
-- ini sudah cukup.
create temporary table vd_a5 as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-A T1XW1 L=10MM|8000|DBT-512|24-AUG-2026'
);
grant select on vd_a5 to public;

select is(
  (select result from vd_a5)::text,
  'not_pass',
  'box berlebih ditolak setelah barisnya lengkap'
);

select is(
  (select size_complete from vd_a5),
  true,
  'penolakannya menyebut bahwa ukuran ini sudah lengkap'
);

-- Baris B: dua box dengan label yang sama persis. Inilah yang ditolak aturan
-- lama karena ia menuntut 1500 lalu 500.
create temporary table vd_b1 as
select * from public.verify_delivery_label(
  (select id from vd_session),
  '10015|UJI-B T1XW1 L=20MM|2000|DBT-512|24-AUG-2026'
);
grant select on vd_b1 to public;

select is(
  (select result from vd_b1)::text,
  'pass',
  'baris 2 box menerima label ber-Qty Delivery, bukan Qty per box'
);

select is(
  (select verified_boxes from vd_b1),
  1,
  'box pertama tercatat'
);

select is(
  (select row_done from vd_b1),
  false,
  'satu box belum melunasi baris yang butuh dua'
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
-- lebih dulu, jadi setelah baris terakhir lunas payload rusak pun tidak sampai
-- ke pembacaan QR-nya.
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
  7,
  'hitungannya box, bukan baris: 4 + 2 + 1'
);

select is(
  (
    select status::text from public.delivery_verification_sessions
    where id = (select id from vd_session)
  ),
  'done',
  'session ikut selesai pada box terakhir'
);

-- Ukuran sheet yang belum ada di MPQ Sheet tetap masuk jadwal. Menolak seluruh
-- file berarti tidak ada jadwal yang bisa diunggah sampai daftar MPQ dikejar --
-- pada DO Report nyata, delapan dari tiga belas baris sheet belum punya MPQ.
create temporary table vd_session2 as
select * from public.create_delivery_verification_session();
grant select on vd_session2 to public;

select public.add_delivery_schedule_rows(
  (select id from vd_session2),
  'jadwal-asing.xlsx',
  '[{"productSize": "UJI-A T1XW1 L=10MM", "qty": "2000"},
    {"productSize": "TANPA-MPQ T9XW9 L=99MM", "qty": "100"},
    {"productSize": "UJI-D T1XW1 L=40MM", "qty": "800"}]'::jsonb
);

select is(
  (
    select count(*)::integer from public.delivery_schedule_rows
    where session_id = (select id from vd_session2)
  ),
  3,
  'ukuran tanpa MPQ tetap masuk jadwal, tidak menggagalkan filenya'
);

select is(
  (
    select mpq_qty from public.delivery_schedule_rows
    where session_id = (select id from vd_session2) and row_no = 3
  ),
  null::integer,
  'MPQ yang dinonaktifkan tidak dipakai jadwal baru'
);

select is(
  (
    select expected_boxes from public.delivery_schedule_rows
    where session_id = (select id from vd_session2) and row_no = 2
  ),
  null::integer,
  'jumlah box tak diketahui ditulis null, bukan 1 -- 100 keping tidak lunas oleh satu label'
);

create temporary table vd_no_mpq as
select * from public.verify_delivery_label(
  (select id from vd_session2),
  '10015|TANPA-MPQ T9XW9 L=99MM|100|DBT-512|24-AUG-2026'
);
grant select on vd_no_mpq to public;

select is(
  (select result from vd_no_mpq)::text,
  'not_pass',
  'baris tanpa MPQ tidak bisa dicocokkan: jumlah box-nya tidak diketahui'
);

select is(
  (select mpq_missing from vd_no_mpq),
  true,
  'penolakannya menyebut bahwa yang kurang data master, bukan labelnya'
);

-- Baris pertama lunas oleh satu box, tetapi baris kedua menahan session.
create temporary table vd_session2_done as
select * from public.verify_delivery_label(
  (select id from vd_session2),
  '10015|UJI-A T1XW1 L=10MM|2000|DBT-512|24-AUG-2026'
);
grant select on vd_session2_done to public;

select is(
  (select delivery_ok from vd_session2_done),
  false,
  'session tidak bisa DELIVERY OK selama masih ada ukuran tanpa MPQ'
);

-- MPQ ditambahkan sesudah jadwalnya diunggah. Tanpa jalan mengisinya, satu
-- angka yang terlambat berarti seluruh file harus diunggah ulang ke session
-- baru.
reset role;
insert into public.mpq_sheet_rows (row_no, product_size, mpq_qty, unit)
values (9005, 'TANPA-MPQ T9XW9 L=99MM', 50, 'PCS/BOX');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91310000-0000-0000-0000-000000000001',
  true
);

-- Baris yang MPQ-nya dinonaktifkan tetap dilewati: nonaktif berarti tidak
-- dipakai, bukan dipakai lewat pintu belakang.
select is(
  public.refresh_delivery_schedule_mpq((select id from vd_session2)),
  1,
  'satu baris terisi; yang MPQ-nya nonaktif tidak ikut'
);

select is(
  (
    select mpq_qty from public.delivery_schedule_rows
    where session_id = (select id from vd_session2) and row_no = 2
  ),
  50,
  'MPQ yang terlambat masuk terisi tanpa mengunggah ulang jadwalnya'
);

select is(
  (
    select expected_boxes from public.delivery_schedule_rows
    where session_id = (select id from vd_session2) and row_no = 2
  ),
  2,
  '100 keping dengan MPQ 50 langsung terbaca sebagai 2 box'
);

-- Baris pertama sudah lunas dengan MPQ 2000. Kalau angka di MPQ Sheet berubah,
-- baris itu tidak boleh ikut berubah -- pemeriksaan yang sudah terjadi tidak
-- boleh dihitung ulang dengan aturan baru.
select is(
  (
    select mpq_qty from public.delivery_schedule_rows
    where session_id = (select id from vd_session2) and row_no = 1
  ),
  2000,
  'baris yang sudah punya MPQ tidak ditimpa'
);

reset role;

select setval(
  'public.delivery_verification_session_seq',
  (select last_value from verify_seq_before),
  (select is_called from verify_seq_before)
);

select * from finish();

rollback;
