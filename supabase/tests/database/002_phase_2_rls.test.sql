begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'phase2-admin@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'phase2-operator@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'phase2-other@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'phase2-inactive@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('10000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'phase2-unassigned@example.test', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, display_name, role, is_active) values
  ('10000000-0000-0000-0000-000000000001', 'Phase 2 Admin', 'admin', true),
  ('10000000-0000-0000-0000-000000000002', 'Phase 2 Operator', 'user', true),
  ('10000000-0000-0000-0000-000000000003', 'Other Operator', 'user', true),
  ('10000000-0000-0000-0000-000000000004', 'Inactive Operator', 'user', false),
  ('10000000-0000-0000-0000-000000000005', 'Unassigned Operator', 'user', true);

insert into public.suppliers (id, supplier_code, supplier_name, is_active) values
  ('20000000-0000-0000-0000-000000000001', 'RLS-ACTIVE', 'RLS Active Supplier', true),
  ('20000000-0000-0000-0000-000000000002', 'RLS-INACTIVE', 'RLS Inactive Supplier', false);

insert into public.products (
  id, product_code, part_name, outer_diameter, inner_diameter, length, is_active
) values (
  '30000000-0000-0000-0000-000000000001', 'RLS-PRODUCT', 'RLS Product', 6.3, 5.5, 205, true
);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, is_active
) values (
  '40000000-0000-0000-0000-000000000001', 'RLS-ITEM', 'RLS-PART', 'RLS Part', 'PCS', 100, true
);

insert into public.master_item_products (id, master_item_id, product_id, is_active) values (
  '50000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  true
);

insert into public.boxes (id, master_item_id, box_no, box_code, box_name) values
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 1, 'RLS-BOX', 'RLS Box');

insert into public.box_layers (
  id, box_id, layer_no, layer_name, sort_order
) values
  ('61000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 1, 'Layer 1', 1);

insert into public.box_layer_requirements (
  id, box_layer_id, product_id, expected_qty, sort_order
) values
  ('62000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 3, 1);

insert into public.packing_sessions (
  id, operator_id, master_item_id, box_id, status
) values
  ('80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'confirmed'),
  ('80000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'confirmed');

set local role anon;
select throws_ok(
  $$ select count(*) from public.suppliers $$,
  '42501', null, 'anonymous cannot read suppliers'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
set local role authenticated;
select results_eq(
  $$ select supplier_code from public.suppliers where supplier_code like 'RLS-%' order by supplier_code $$,
  array['RLS-ACTIVE'::text],
  'active operator reads active suppliers only'
);
select results_eq(
  $$ select id from public.profiles $$,
  array['10000000-0000-0000-0000-000000000002'::uuid],
  'operator reads own profile only'
);
select results_eq(
  $$ select id from public.packing_sessions $$,
  array['80000000-0000-0000-0000-000000000001'::uuid],
  'operator reads own session only'
);
select throws_ok(
  $$ insert into public.suppliers (supplier_code, supplier_name) values ('RLS-DENIED', 'Denied') $$,
  '42501', null, 'operator cannot create suppliers'
);
select throws_ok(
  $$ insert into public.packing_sessions (operator_id, master_item_id, box_id) values ('10000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'operator cannot mutate packing sessions directly'
);
select throws_ok(
  $$ insert into public.audit_logs (actor_id, action, entity_type) values ('10000000-0000-0000-0000-000000000002', 'test', 'test') $$,
  '42501', null, 'operator cannot append audit directly'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
set local role authenticated;
select is_empty(
  $$ select id from public.packing_sessions $$,
  'unassigned operator cannot read sessions'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select is_empty(
  $$ select id from public.suppliers $$,
  'inactive operator cannot read master data'
);
select results_eq(
  $$ select is_active from public.profiles $$,
  array[false],
  'inactive operator can read only their own profile status'
);
reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select results_eq(
  $$ select count(*)::bigint from public.profiles where id in ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004') $$,
  array[4::bigint],
  'admin reads all profiles'
);
select results_eq(
  $$ select count(*)::bigint from public.suppliers where supplier_code like 'RLS-%' $$,
  array[2::bigint],
  'admin reads active and inactive master rows'
);
select lives_ok(
  $$ insert into public.suppliers (supplier_code, supplier_name) values ('RLS-ADMIN', 'Admin Supplier') $$,
  'admin can create master data'
);
select lives_ok(
  $$ update public.suppliers set supplier_name = 'Admin Updated' where supplier_code = 'RLS-ADMIN' $$,
  'admin update policy has usable USING and WITH CHECK predicates'
);
select lives_ok(
  $$ delete from public.suppliers where supplier_code = 'RLS-ADMIN' $$,
  'admin can delete unreferenced master data'
);
select results_eq(
  $$ select count(*)::bigint from public.packing_sessions $$,
  array[2::bigint],
  'admin reads all packing sessions'
);
select throws_ok(
  $$ insert into public.audit_logs (actor_id, action, entity_type) values ('10000000-0000-0000-0000-000000000001', 'test', 'test') $$,
  '42501', null, 'admin cannot append audit directly'
);
select results_eq(
  $$
    select box.box_code
    from public.packing_sessions session
    join public.boxes box on box.id = session.box_id
    where session.id = '80000000-0000-0000-0000-000000000001'
  $$,
  array['RLS-BOX'::text],
  'packing session box_id joins directly to boxes'
);
reset role;

select ok(
  has_function_privilege('authenticated', 'private.is_active_admin()', 'EXECUTE'),
  'authenticated may execute the admin policy helper'
);
select ok(
  not has_function_privilege('anon', 'private.is_active_admin()', 'EXECUTE'),
  'anonymous cannot execute the admin policy helper'
);
select is(
  (
    select count(*)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename = 'suppliers'
      and cmd = 'UPDATE'
      and qual is not null
      and with_check is not null
  ),
  1,
  'supplier update policy defines USING and WITH CHECK'
);
select ok(
  not has_table_privilege('authenticated', 'public.sequence_counters', 'SELECT')
  and exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'sequence_counters'
      and policyname = 'sequence_counters_no_direct_access'
  ),
  'sequence counters have explicit deny policy and no browser grant'
);

select * from finish();
rollback;
