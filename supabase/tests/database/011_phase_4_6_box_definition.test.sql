begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(21);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91100000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'phase46-admin@example.test',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '91100000-0000-0000-0000-000000000001',
  'Phase 4.6 Admin',
  'admin',
  true
);

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
  'public',
  'create_box_definition',
  array['uuid', 'text', 'text', 'jsonb'],
  'create Box Definition RPC exists'
);

select has_function(
  'public',
  'update_box_definition',
  array['uuid', 'text', 'text', 'jsonb'],
  'update Box Definition RPC exists'
);

select has_function(
  'public',
  'publish_box_definition',
  array['uuid'],
  'publish Box Definition RPC exists'
);

select has_function(
  'public',
  'clone_box_definition_version',
  array['uuid'],
  'clone Box Definition RPC exists'
);

select set_config(
  'request.jwt.claim.sub',
  '91100000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select lives_ok(
  $$
    select public.create_box_definition(
      '92100000-0000-0000-0000-000000000001',
      ' b101 ',
      ' B101 Example ',
      '[
        {
          "name": " Layer 1 ",
          "requirements": [
            {
              "product_id": "93100000-0000-0000-0000-000000000001",
              "expected_qty": 3
            }
          ]
        },
        {
          "name": "Layer 2",
          "requirements": [
            {
              "product_id": "93100000-0000-0000-0000-000000000001",
              "expected_qty": 5
            }
          ]
        }
      ]'::jsonb
    )
  $$,
  'admin creates ordered Box Definition content'
);

select is(
  (
    select string_agg(
      layer.layer_no::text || ':' || layer.sort_order::text || ':' || layer.layer_name
        || ':' || requirement.sort_order::text || ':' || requirement.expected_qty::text,
      ',' order by layer.sort_order, requirement.sort_order
    )
    from public.box_definitions definition
    join public.box_layers layer on layer.box_definition_id = definition.id
    join public.box_layer_requirements requirement on requirement.box_layer_id = layer.id
    where definition.master_item_id = '92100000-0000-0000-0000-000000000001'
      and definition.box_code = 'B101'
      and definition.version = 1
  ),
  '1:1:Layer 1:1:3,2:2:Layer 2:1:5',
  'create normalizes the code and persists contiguous ordered children'
);

select is(
  (
    select count(*)::integer
    from public.audit_logs
    where action = 'box_definition.created'
      and entity_type = 'box_definition'
      and metadata @> '{"box_code":"B101","version":1}'::jsonb
  ),
  1,
  'create is audited with box code and version metadata'
);

select throws_ok(
  $$
    select public.create_box_definition(
      '92100000-0000-0000-0000-000000000001',
      'B102',
      'B102',
      '[{
        "name": "Layer 1",
        "requirements": [{
          "product_id": "93100000-0000-0000-0000-000000000001",
          "expected_qty": 0
        }]
      }]'::jsonb
    )
  $$,
  'P0001',
  'BOX_DEFINITION_INPUT_INVALID',
  'zero requirement quantity is rejected'
);

select lives_ok(
  $$
    select public.publish_box_definition(id)
    from public.box_definitions
    where master_item_id = '92100000-0000-0000-0000-000000000001'
      and box_code = 'B101'
      and version = 1
  $$,
  'admin publishes a valid Box Definition'
);

select is(
  (
    select is_active
    from public.box_definitions
    where master_item_id = '92100000-0000-0000-0000-000000000001'
      and box_code = 'B101'
      and version = 1
  ),
  true,
  'publish activates the selected version'
);

reset role;

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '91100000-0000-0000-0000-000000000002',
  'authenticated',
  'authenticated',
  'phase46-operator@example.test',
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

insert into public.profiles (id, display_name, role, is_active) values (
  '91100000-0000-0000-0000-000000000002',
  'Phase 4.6 Operator',
  'operator',
  true
);

insert into public.workstations (id, workstation_code, name) values (
  '94100000-0000-0000-0000-000000000001',
  'phase46-workstation',
  'Phase 4.6 Workstation'
);

insert into public.packing_sessions (
  operator_id, workstation_id, master_item_id, box_definition_id, status
) values (
  '91100000-0000-0000-0000-000000000002',
  '94100000-0000-0000-0000-000000000001',
  '92100000-0000-0000-0000-000000000001',
  (
    select id
    from public.box_definitions
    where master_item_id = '92100000-0000-0000-0000-000000000001'
      and box_code = 'B101'
      and version = 1
  ),
  'draft'
);

select set_config(
  'request.jwt.claim.sub',
  '91100000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select throws_ok(
  $$
    select public.update_box_definition(
      (
        select id
        from public.box_definitions
        where master_item_id = '92100000-0000-0000-0000-000000000001'
          and box_code = 'B101'
          and version = 1
      ),
      'B101',
      'Changed B101',
      '[{
        "name": "Layer 1",
        "requirements": [{
          "product_id": "93100000-0000-0000-0000-000000000001",
          "expected_qty": 3
        }]
      }]'::jsonb
    )
  $$,
  'P0001',
  'BOX_DEFINITION_IN_USE',
  'used Box Definition cannot be updated'
);

select lives_ok(
  $$
    select public.clone_box_definition_version(id)
    from public.box_definitions
    where master_item_id = '92100000-0000-0000-0000-000000000001'
      and box_code = 'B101'
      and version = 1
  $$,
  'admin clones a used Box Definition into a draft version'
);

select is(
  (
    select definition.version::text || ':' || definition.is_active::text || ':' || string_agg(
      layer.layer_no::text || ':' || layer.sort_order::text || ':' || layer.layer_name
        || ':' || requirement.sort_order::text || ':' || requirement.expected_qty::text,
      ',' order by layer.sort_order, requirement.sort_order
    )
    from public.box_definitions definition
    join public.box_layers layer on layer.box_definition_id = definition.id
    join public.box_layer_requirements requirement on requirement.box_layer_id = layer.id
    where definition.master_item_id = '92100000-0000-0000-0000-000000000001'
      and definition.box_code = 'B101'
      and definition.version = 2
    group by definition.version, definition.is_active
  ),
  '2:false:1:1:Layer 1:1:3,2:2:Layer 2:1:5',
  'clone creates inactive version two with the ordered source content'
);

select set_config(
  'request.jwt.claim.sub',
  '91100000-0000-0000-0000-000000000002',
  true
);

select throws_ok(
  $$
    select public.create_box_definition(
      '92100000-0000-0000-0000-000000000001',
      'B102',
      'B102',
      '[]'::jsonb
    )
  $$,
  'P0001',
  'BOX_DEFINITION_ADMIN_REQUIRED',
  'authenticated non-admin cannot create a Box Definition'
);

select throws_ok(
  $$
    select public.update_box_definition(
      '92100000-0000-0000-0000-000000000001',
      'B101',
      'B101',
      '[]'::jsonb
    )
  $$,
  'P0001',
  'BOX_DEFINITION_ADMIN_REQUIRED',
  'authenticated non-admin cannot update a Box Definition'
);

select throws_ok(
  $$
    select public.publish_box_definition('92100000-0000-0000-0000-000000000001')
  $$,
  'P0001',
  'BOX_DEFINITION_ADMIN_REQUIRED',
  'authenticated non-admin cannot publish a Box Definition'
);

select throws_ok(
  $$
    select public.clone_box_definition_version('92100000-0000-0000-0000-000000000001')
  $$,
  'P0001',
  'BOX_DEFINITION_ADMIN_REQUIRED',
  'authenticated non-admin cannot clone a Box Definition'
);

reset role;
set local role anon;

select throws_ok(
  $$
    select public.create_box_definition(
      '92100000-0000-0000-0000-000000000001',
      'B103',
      'B103',
      '[]'::jsonb
    )
  $$,
  '42501',
  'permission denied for function create_box_definition',
  'anon has no execute privilege on the create RPC'
);

select throws_ok(
  $$
    select public.update_box_definition(
      '92100000-0000-0000-0000-000000000001',
      'B101',
      'B101',
      '[]'::jsonb
    )
  $$,
  '42501',
  'permission denied for function update_box_definition',
  'anon has no execute privilege on the update RPC'
);

select throws_ok(
  $$
    select public.publish_box_definition('92100000-0000-0000-0000-000000000001')
  $$,
  '42501',
  'permission denied for function publish_box_definition',
  'anon has no execute privilege on the publish RPC'
);

select throws_ok(
  $$
    select public.clone_box_definition_version('92100000-0000-0000-0000-000000000001')
  $$,
  '42501',
  'permission denied for function clone_box_definition_version',
  'anon has no execute privilege on the clone RPC'
);

reset role;

select * from finish();

rollback;
