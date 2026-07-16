begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'phase45-admin@example.test',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '91000000-0000-0000-0000-000000000001',
  'Phase 4.5 Admin',
  'admin',
  true
);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, is_active
) values (
  '92000000-0000-0000-0000-000000000001',
  'phase45-item',
  'PHASE45-PART',
  'Phase 4.5 Part',
  'Pcs',
  100,
  true
);

insert into public.products (
  id, product_code, part_name, outer_diameter, inner_diameter, length, is_active
) values (
  '93000000-0000-0000-0000-000000000001',
  'phase45-product',
  'Phase 4.5 Product',
  6.3,
  5.5,
  205,
  true
);

select has_function(
  'public',
  'create_master_item_product_mapping',
  array['uuid', 'uuid'],
  'product mapping create RPC exists'
);

select set_config(
  'request.jwt.claim.sub',
  '91000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select lives_ok(
  $$ select public.create_master_item_product_mapping(
    '92000000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000001'
  ) $$,
  'admin creates an active Product Mapping'
);

select is(
  (
    select count(*)::integer
    from public.master_item_products
    where master_item_id = '92000000-0000-0000-0000-000000000001'
      and product_id = '93000000-0000-0000-0000-000000000001'
      and is_active
  ),
  1,
  'create stores exactly one active mapping'
);

select throws_ok(
  $$ select public.create_master_item_product_mapping(
    '92000000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000001'
  ) $$,
  'P0001',
  'PRODUCT_MAPPING_EXISTS',
  'duplicate active mapping is rejected'
);

select lives_ok(
  $$ select public.set_master_item_product_active(
    (select id from public.master_item_products where master_item_id = '92000000-0000-0000-0000-000000000001'),
    false
  ) $$,
  'admin deactivates mapping without deleting history'
);

select is(
  (
    select count(*)::integer
    from public.master_item_products
    where master_item_id = '92000000-0000-0000-0000-000000000001'
      and product_id = '93000000-0000-0000-0000-000000000001'
      and not is_active
  ),
  1,
  'deactivate retains one inactive mapping row'
);

select lives_ok(
  $$ select public.create_master_item_product_mapping(
    '92000000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000001'
  ) $$,
  'create reactivates inactive mapping'
);

select is(
  (
    select count(*)::integer
    from public.master_item_products
    where master_item_id = '92000000-0000-0000-0000-000000000001'
      and product_id = '93000000-0000-0000-0000-000000000001'
      and is_active
  ),
  1,
  'reactivation preserves pair uniqueness'
);

select is(
  (
    select count(*)::integer
    from public.audit_logs
    where action in (
      'product_mapping.created',
      'product_mapping.deactivated',
      'product_mapping.reactivated'
    )
      and entity_type = 'master_item_product'
  ),
  3,
  'create, deactivate, and reactivate are audited'
);

reset role;

select has_function(
  'public',
  'set_master_item_product_active',
  array['uuid', 'boolean'],
  'product mapping activation RPC exists'
);

select * from finish();

rollback;
