begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(22);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('91180000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
    'box-owned-admin@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('91180000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
    'box-owned-operator@example.test', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, display_name, role, is_active) values
  ('91180000-0000-0000-0000-000000000001', 'Box Owned Admin', 'admin', true),
  ('91180000-0000-0000-0000-000000000002', 'Box Owned Operator', 'operator', true);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, is_active
) values (
  '92180000-0000-0000-0000-000000000001', 'box-owned-item', 'BOX-OWNED-PART',
  'Box Owned Part', 'Pcs', 100, true
);

insert into public.products (
  id, product_code, part_name, outer_diameter, inner_diameter, length, is_active
) values (
  '93180000-0000-0000-0000-000000000001', 'box-owned-product', 'Box Owned Product',
  6.3, 5.5, 205, true
);

select has_function('public', 'create_master_item_box', array['uuid'], 'create_master_item_box RPC exists');
select has_function('public', 'delete_master_item_box', array['uuid'], 'delete_master_item_box RPC exists');
select has_function('public', 'create_box_layer', array['uuid'], 'create_box_layer RPC exists');
select has_function('public', 'delete_box_layer', array['uuid'], 'delete_box_layer RPC exists');
select has_function(
  'public', 'save_box_layer_requirements', array['uuid', 'jsonb'],
  'save_box_layer_requirements RPC exists'
);

select set_config('request.jwt.claim.sub', '91180000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$ select public.create_master_item_box('92180000-0000-0000-0000-000000000001') $$,
  'admin creates the first Box for a Master Item'
);
select lives_ok(
  $$ select public.create_master_item_box('92180000-0000-0000-0000-000000000001') $$,
  'admin creates a second Box'
);
select lives_ok(
  $$ select public.create_master_item_box('92180000-0000-0000-0000-000000000001') $$,
  'admin creates a third Box'
);

select is(
  (
    select string_agg(box_no::text || ':' || box_name, ',' order by box_no)
    from public.boxes where master_item_id = '92180000-0000-0000-0000-000000000001'
  ),
  '1:Box 1,2:Box 2,3:Box 3',
  'boxes get sequential auto slot number and name'
);

select matches(
  (select box_code from public.boxes where box_no = 1 and master_item_id = '92180000-0000-0000-0000-000000000001'),
  '^box-\d+$',
  'box_code is auto-generated in box-NN format'
);

select throws_ok(
  $$ select public.create_master_item_box('92180000-0000-0000-0000-000000000001') $$,
  'P0001', 'MASTER_ITEM_BOX_LIMIT_REACHED',
  'a 4th Box is rejected once 3 exist'
);

select lives_ok(
  $$
    select public.delete_master_item_box(
      (select id from public.boxes where box_no = 2 and master_item_id = '92180000-0000-0000-0000-000000000001')
    )
  $$,
  'admin deletes an unused Box'
);

select lives_ok(
  $$ select public.create_master_item_box('92180000-0000-0000-0000-000000000001') $$,
  'a new Box reuses the freed slot number'
);

select is(
  (select box_name from public.boxes where box_no = 2 and master_item_id = '92180000-0000-0000-0000-000000000001'),
  'Box 2',
  'the reused slot is named Box 2 again'
);

select lives_ok(
  $$
    select public.create_box_layer(
      (select id from public.boxes where box_no = 1 and master_item_id = '92180000-0000-0000-0000-000000000001')
    )
  $$,
  'admin adds the first Layer to Box 1'
);
select lives_ok(
  $$
    select public.create_box_layer(
      (select id from public.boxes where box_no = 1 and master_item_id = '92180000-0000-0000-0000-000000000001')
    )
  $$,
  'admin adds a second Layer to Box 1'
);

select is(
  (
    select string_agg(layer_no::text || ':' || layer_name, ',' order by layer_no)
    from public.box_layers layer
    join public.boxes box on box.id = layer.box_id
    where box.box_no = 1 and box.master_item_id = '92180000-0000-0000-0000-000000000001'
  ),
  '1:Box 1 - Layer 1,2:Box 1 - Layer 2',
  'layers get sequential auto layer number and name embedding the box number'
);

select throws_ok(
  $$
    select public.delete_box_layer(
      (select layer.id from public.box_layers layer join public.boxes box on box.id = layer.box_id
       where box.box_no = 1 and box.master_item_id = '92180000-0000-0000-0000-000000000001' and layer.layer_no = 1)
    )
  $$,
  'P0001', 'BOX_LAYER_NOT_LAST',
  'only the highest-numbered layer of a box can be deleted'
);

select lives_ok(
  $$
    select public.save_box_layer_requirements(
      (select layer.id from public.box_layers layer join public.boxes box on box.id = layer.box_id
       where box.box_no = 1 and box.master_item_id = '92180000-0000-0000-0000-000000000001' and layer.layer_no = 1),
      jsonb_build_array(jsonb_build_object(
        'product_id', '93180000-0000-0000-0000-000000000001', 'expected_qty', 5
      ))
    )
  $$,
  'admin saves product requirements for a layer'
);

select is(
  (
    select count(*)::integer from public.master_item_products
    where master_item_id = '92180000-0000-0000-0000-000000000001'
      and product_id = '93180000-0000-0000-0000-000000000001' and is_active
  ),
  1,
  'saving a requirement auto-syncs the product into master_item_products'
);

select set_config('request.jwt.claim.sub', '91180000-0000-0000-0000-000000000002', true);

select throws_ok(
  $$ select public.create_master_item_box('92180000-0000-0000-0000-000000000001') $$,
  'P0001', 'MASTER_ITEM_BOX_ADMIN_REQUIRED', 'non-admin cannot create a Box'
);

reset role;
set local role anon;

select throws_ok(
  $$ select public.create_master_item_box('92180000-0000-0000-0000-000000000001') $$,
  '42501', 'permission denied for function create_master_item_box',
  'anon has no execute privilege on create_master_item_box'
);

reset role;

select * from finish();

rollback;
