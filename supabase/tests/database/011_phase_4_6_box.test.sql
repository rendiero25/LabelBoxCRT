begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(25);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '91100000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'phase46-admin@example.test',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '91100000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'phase46-operator@example.test',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

insert into public.profiles (id, display_name, role, is_active) values
  ('91100000-0000-0000-0000-000000000001', 'Phase 4.6 Admin', 'admin', true),
  ('91100000-0000-0000-0000-000000000002', 'Phase 4.6 Operator', 'operator', true);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, is_active
) values (
  '92100000-0000-0000-0000-000000000001',
  'phase46-item',
  'PHASE46-PART',
  'Phase 4.6 Part',
  'Pcs',
  100,
  true
);

insert into public.products (
  id, product_code, part_name, outer_diameter, inner_diameter, length, is_active
) values (
  '93100000-0000-0000-0000-000000000001',
  'phase46-product',
  'Phase 4.6 Product',
  6.3,
  5.5,
  205,
  true
);

insert into public.master_item_products (master_item_id, product_id, is_active) values (
  '92100000-0000-0000-0000-000000000001',
  '93100000-0000-0000-0000-000000000001',
  true
);

select has_function(
  'public', 'create_box', array['text', 'jsonb'], 'create Box RPC exists'
);
select has_function(
  'public', 'update_box', array['uuid', 'text', 'jsonb'], 'update Box RPC exists'
);
select has_function(
  'public', 'set_box_active', array['uuid', 'boolean'], 'set Box active RPC exists'
);
select has_function(
  'public', 'delete_box', array['uuid'], 'delete Box RPC exists'
);

select set_config('request.jwt.claim.sub', '91100000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$
    select public.create_box(
      ' Phase 4.6 Box Example ',
      '[{"name": " Layer 1 "}, {"name": "Layer 2"}]'::jsonb
    )
  $$,
  'admin creates a Box with ordered layers'
);

select is(
  (
    select string_agg(layer_no::text || ':' || sort_order::text || ':' || layer_name, ',' order by sort_order)
    from public.box_layers layer
    join public.boxes box on box.id = layer.box_id
    where box.box_name = 'Phase 4.6 Box Example'
  ),
  '1:1:Layer 1,2:2:Layer 2',
  'create normalizes layer names and persists contiguous ordered layers'
);

select matches(
  (select box_code from public.boxes where box_name = 'Phase 4.6 Box Example'),
  '^box-\d+$',
  'create generates a box_code in the box-NN format'
);

select is(
  (
    select count(*)::integer from public.audit_logs
    where action = 'box.created' and entity_type = 'box'
      and entity_id = (
        select id::text from public.boxes where box_name = 'Phase 4.6 Box Example'
      )
  ),
  1,
  'create is audited with box code metadata'
);

select throws_ok(
  $$ select public.create_box('Phase 4.6 Empty Layers', '[]'::jsonb) $$,
  'P0001',
  'BOX_INPUT_INVALID',
  'an empty layer list is rejected'
);

select lives_ok(
  $$ select public.create_box('Phase 4.6 Box Second', '[{"name": "Layer 1"}]'::jsonb) $$,
  'admin creates a second Box to check code sequencing'
);

select ok(
  (
    select (regexp_match(box_code, '^box-(\d+)$'))[1]::integer
      > (
        select (regexp_match(box_code, '^box-(\d+)$'))[1]::integer
        from public.boxes where box_name = 'Phase 4.6 Box Example'
      )
    from public.boxes where box_name = 'Phase 4.6 Box Second'
  ),
  'each created Box gets a distinct, incrementing box_code'
);

select lives_ok(
  $$
    select public.update_box(
      (select id from public.boxes where box_name = 'Phase 4.6 Box Example'),
      'Phase 4.6 Box Renamed',
      '[{"name": "Layer One"}, {"name": "Layer Two"}]'::jsonb
    )
  $$,
  'admin updates an unused Box, including its layers'
);

select is(
  (
    select box_name || ':' || (
      select string_agg(layer_name, ',' order by sort_order)
      from public.box_layers layer where layer.box_id = box.id
    )
    from public.boxes box where box_name = 'Phase 4.6 Box Renamed'
  ),
  'Phase 4.6 Box Renamed:Layer One,Layer Two',
  'update persists the revised name and layer names while unused'
);

insert into public.master_item_boxes (
  id, master_item_id, box_id, version, is_active
) values (
  '95100000-0000-0000-0000-000000000001',
  '92100000-0000-0000-0000-000000000001',
  (select id from public.boxes where box_name = 'Phase 4.6 Box Renamed'),
  1,
  false
);

select lives_ok(
  $$
    select public.update_box(
      (select id from public.boxes where box_name = 'Phase 4.6 Box Renamed'),
      'Phase 4.6 Box In Use',
      '[{"name": "Attempted Rename"}]'::jsonb
    )
  $$,
  'admin updates a Box already adopted by a Master Item'
);

select is(
  (
    select box_name || ':' || (
      select string_agg(layer_name, ',' order by sort_order)
      from public.box_layers layer where layer.box_id = box.id
    )
    from public.boxes box where box_name = 'Phase 4.6 Box In Use'
  ),
  'Phase 4.6 Box In Use:Layer One,Layer Two',
  'name updates but the layer shape stays locked once a Master Item has adopted it'
);

select throws_ok(
  $$ select public.delete_box((select id from public.boxes where box_name = 'Phase 4.6 Box In Use')) $$,
  'P0001',
  'BOX_IN_USE',
  'a Box referenced by master_item_boxes cannot be deleted'
);

select lives_ok(
  $$ select public.create_box('Phase 4.6 Throwaway', '[{"name": "Layer 1"}]'::jsonb) $$,
  'admin creates a throwaway Box for the delete test'
);

select lives_ok(
  $$ select public.delete_box((select id from public.boxes where box_name = 'Phase 4.6 Throwaway')) $$,
  'an unused Box can be deleted'
);

select is(
  (select count(*)::integer from public.boxes where box_name = 'Phase 4.6 Throwaway'),
  0,
  'delete removes the Box row'
);

select lives_ok(
  $$ select public.set_box_active((select id from public.boxes where box_name = 'Phase 4.6 Box In Use'), false) $$,
  'admin deactivates a Box'
);

select is(
  (select is_active from public.boxes where box_name = 'Phase 4.6 Box In Use'),
  false,
  'deactivation persists'
);

select set_config('request.jwt.claim.sub', '91100000-0000-0000-0000-000000000002', true);

select throws_ok(
  $$ select public.create_box('Phase 4.6 Non Admin', '[{"name": "Layer 1"}]'::jsonb) $$,
  'P0001', 'BOX_ADMIN_REQUIRED', 'non-admin cannot create a Box'
);
select throws_ok(
  $$
    select public.update_box(
      (select id from public.boxes where box_name = 'Phase 4.6 Box In Use'),
      'Phase 4.6 Box In Use',
      '[]'::jsonb
    )
  $$,
  'P0001', 'BOX_ADMIN_REQUIRED', 'non-admin cannot update a Box'
);
select throws_ok(
  $$ select public.set_box_active((select id from public.boxes where box_name = 'Phase 4.6 Box In Use'), true) $$,
  'P0001', 'BOX_ADMIN_REQUIRED', 'non-admin cannot change Box active state'
);
select throws_ok(
  $$ select public.delete_box((select id from public.boxes where box_name = 'Phase 4.6 Box In Use')) $$,
  'P0001', 'BOX_ADMIN_REQUIRED', 'non-admin cannot delete a Box'
);

reset role;
set local role anon;

select throws_ok(
  $$ select public.create_box('Phase 4.6 Anon', '[{"name": "Layer 1"}]'::jsonb) $$,
  '42501', 'permission denied for function create_box', 'anon has no execute privilege on create_box'
);
select throws_ok(
  $$ select public.update_box('92100000-0000-0000-0000-000000000001', 'Phase 4.6 Anon', '[]'::jsonb) $$,
  '42501', 'permission denied for function update_box', 'anon has no execute privilege on update_box'
);
select throws_ok(
  $$ select public.set_box_active('92100000-0000-0000-0000-000000000001', true) $$,
  '42501', 'permission denied for function set_box_active', 'anon has no execute privilege on set_box_active'
);
select throws_ok(
  $$ select public.delete_box('92100000-0000-0000-0000-000000000001') $$,
  '42501', 'permission denied for function delete_box', 'anon has no execute privilege on delete_box'
);

reset role;

select * from finish();

rollback;
