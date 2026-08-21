-- Master item item_code auto-generation: create_master_item generates
-- mstritem-NN when p_item_code is omitted, still honors an explicit value
-- (the CSV import path), and update_master_item can no longer change
-- item_code at all. Spec:
-- docs/superpowers/specs/2026-07-22-master-item-code-autogen-design.md

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(12);

-- Parkir master_item_code_seq tepat di 99 supaya dua create pertama di bawah
-- menyeberangi batas dua digit: 99 lalu 100. Di situlah lpad(teks, 2, '0')
-- dulu memotong dan mengembalikan 'mstritem-10'. Nilai aslinya dikembalikan
-- di akhir file -- setval tidak ikut rollback, jadi ia harus dipulangkan
-- sendiri.
create temporary table master_item_code_seq_before as
select last_value, is_called from public.master_item_code_seq;

select setval('public.master_item_code_seq', 99, false);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '9d100000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'master-item-code-admin@example.test',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '9d100000-0000-0000-0000-000000000001',
  'Master Item Code Admin',
  'admin',
  true
);

select set_config(
  'request.jwt.claim.sub',
  '9d100000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select has_function(
  'public',
  'create_master_item',
  array['text', 'text', 'text', 'integer', 'text', 'uuid'],
  'create_master_item takes part_no, part_name, unit, qty, an optional item code, and an optional supplier'
);

select has_function(
  'public',
  'update_master_item',
  array['uuid', 'text', 'text', 'text', 'integer', 'uuid'],
  'update_master_item no longer accepts an item code but does accept an optional supplier'
);

select lives_ok(
  $$ select public.create_master_item('AUTOGEN-A', 'Autogen Part A', 'Pcs', 100) $$,
  'admin creates a master item without providing a code'
);

select matches(
  (select item_code from public.master_items where part_no = 'AUTOGEN-A'),
  '^mstritem-[0-9]{2,}$',
  'first automatic item code uses the required format'
);

select lives_ok(
  $$ select public.create_master_item('AUTOGEN-B', 'Autogen Part B', 'Pcs', 100) $$,
  'admin creates a second master item without providing a code'
);

select isnt(
  (select item_code from public.master_items where part_no = 'AUTOGEN-A'),
  (select item_code from public.master_items where part_no = 'AUTOGEN-B'),
  'automatic item codes are unique'
);

select is(
  (select item_code from public.master_items where part_no = 'AUTOGEN-B'),
  'mstritem-100',
  'the code after mstritem-99 widens instead of truncating back to mstritem-10'
);

select lives_ok(
  $$ select public.create_master_item('AUTOGEN-C', 'Autogen Part C', 'Pcs', 100, 'manual-csv-code') $$,
  'admin (simulating CSV import) creates a master item with an explicit code'
);

select is(
  (select item_code from public.master_items where part_no = 'AUTOGEN-C'),
  'manual-csv-code',
  'an explicitly provided item code is used as-is'
);

select throws_ok(
  $$ select public.create_master_item('AUTOGEN-D', 'Autogen Part D', 'Pcs', 100, 'manual-csv-code') $$,
  'P0001', 'MASTER_ITEM_CODE_EXISTS', 'duplicate explicit item codes are still rejected'
);

create temporary table item_code_before_update as
select item_code from public.master_items where part_no = 'AUTOGEN-A';

select lives_ok(
  $$ select public.update_master_item(
    (select id from public.master_items where part_no = 'AUTOGEN-A'),
    'AUTOGEN-A',
    'Autogen Part A Updated',
    'Pcs',
    150
  ) $$,
  'admin updates a master item without an item code parameter'
);

select is(
  (select item_code from public.master_items where part_no = 'AUTOGEN-A'),
  (select item_code from item_code_before_update),
  'item_code is unchanged after update_master_item runs'
);

reset role;

select setval(
  'public.master_item_code_seq',
  (select last_value from master_item_code_seq_before),
  (select is_called from master_item_code_seq_before)
);

select * from finish();

rollback;
