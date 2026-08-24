-- Field ketiga QR membawa Packing Qty kiriman, bukan Qty/Box Master Item.
--
-- Dulu field itu berisi master_items.default_label_qty: angka yang sama untuk
-- setiap kiriman Master Item itu, jadi QR-nya tidak memberi tahu apa pun soal
-- kiriman yang sedang dipegang.
--
-- Ketiga angka di bawah sengaja dibuat berbeda semua -- Qty/Box 100, Qty
-- Delivery 200, Packing Qty 5000 -- karena di project dev ketiganya sering
-- kebetulan sama, dan tes yang memakai angka kembar tidak bisa membedakan mana
-- yang benar-benar terbawa ke QR.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(6);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91290000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
  'qr-packing-qty@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '91290000-0000-0000-0000-000000000001', 'QR Packing Qty Operator', 'user', true
);

insert into public.suppliers (id, supplier_code, supplier_name, is_active) values (
  '95290000-0000-0000-0000-000000000001', 'QRPQ', 'QR Packing Qty Supplier', true
);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id, is_active
) values (
  '96290000-0000-0000-0000-000000000001', 'qrpq-item', 'QRPQ-PART',
  'QR Packing Qty Part', 'Pcs', 100, '95290000-0000-0000-0000-000000000001', true
);

insert into public.boxes (id, master_item_id, box_no, box_code, box_name) values
  ('98290000-0000-0000-0000-000000000001',
    '96290000-0000-0000-0000-000000000001', 1, 'qrpq-01', 'Box 1'),
  ('98290000-0000-0000-0000-000000000002',
    '96290000-0000-0000-0000-000000000001', 2, 'qrpq-02', 'Box 2');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '91290000-0000-0000-0000-000000000001',
  true
);

-- Qty Delivery 200 / Qty/Box 100 = 2 set, dikali 2 box = 4 label.
create temporary table qrpq_batch as
select *
from public.create_label_box_batch(
  '95290000-0000-0000-0000-000000000001',
  'DN-QRPQ-1',
  date '2026-08-19',
  date '2026-08-19',
  '96290000-0000-0000-0000-000000000001',
  200,
  'LOT-QRPQ',
  'OP-QRPQ',
  5000
);
grant select on qrpq_batch to public;

select is(
  (select label_count from qrpq_batch),
  4,
  'qty delivery 200 dengan qty/box 100 dan 2 box menghasilkan 4 label'
);

select is(
  (select qty_delivery_display from qrpq_batch),
  5000,
  'packing qty tersimpan apa adanya, tidak tertimpa qty delivery'
);

select is(
  (select packing_qty from qrpq_batch),
  100,
  'packing_qty tetap Qty/Box milik Master Item'
);

select is(
  (
    select qr_payload
    from public.label_boxes
    where batch_id = (select batch_id from qrpq_batch) and box_number = 'B101'
  ),
  'QRPQ|QRPQ-PART|5000|' ||
    (select master_item_row_no from qrpq_batch)::text ||
    '-LOT-QRPQ-B101|19-AUG-2026',
  'field ketiga QR berisi Packing Qty, bukan Qty/Box maupun Qty Delivery'
);

-- Setiap label batch ini membawa angka yang sama: Packing Qty milik kiriman,
-- bukan milik box-nya sendiri.
select is(
  (
    select count(distinct split_part(qr_payload, '|', 3))::integer
    from public.label_boxes
    where batch_id = (select batch_id from qrpq_batch)
  ),
  1,
  'keempat label membawa angka ketiga yang sama'
);

-- Rakit ulang memakai aturan yang sama. Kalau hanya create yang diperbaiki,
-- batch yang disunting akan diam-diam kembali membawa Qty/Box.
create temporary table qrpq_rebuilt as
select *
from public.rebuild_label_box_batch(
  (select batch_id from qrpq_batch),
  '95290000-0000-0000-0000-000000000001',
  'DN-QRPQ-1',
  date '2026-08-19',
  date '2026-08-19',
  '96290000-0000-0000-0000-000000000001',
  200,
  'LOT-QRPQ',
  'OP-QRPQ',
  7000
);
grant select on qrpq_rebuilt to public;

select is(
  (
    select qr_payload
    from public.label_boxes
    where batch_id = (select batch_id from qrpq_rebuilt) and box_number = 'B101'
  ),
  'QRPQ|QRPQ-PART|7000|' ||
    (select master_item_row_no from qrpq_rebuilt)::text ||
    '-LOT-QRPQ-B101|19-AUG-2026',
  'rakit ulang juga membawa Packing Qty yang baru ke QR'
);

reset role;

select * from finish();

rollback;
