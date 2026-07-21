begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(12);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '91300000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'master-item-requirements-admin@example.test',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '91300000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'master-item-requirements-operator@example.test',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

insert into public.profiles (id, display_name, role, is_active) values
  ('91300000-0000-0000-0000-000000000001', 'Requirements Admin', 'admin', true),
  ('91300000-0000-0000-0000-000000000002', 'Requirements Operator', 'operator', true);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, is_active
) values
  (
    '92300000-0000-0000-0000-000000000001',
    'requirements-item-one',
    'REQUIREMENTS-PART-ONE',
    'Requirements Item One',
    'Pcs',
    100,
    true
  ),
  (
    '92300000-0000-0000-0000-000000000002',
    'requirements-item-two',
    'REQUIREMENTS-PART-TWO',
    'Requirements Item Two',
    'Pcs',
    100,
    true
  );

insert into public.products (
  id, product_code, part_name, outer_diameter, inner_diameter, length, is_active
) values
  (
    '93300000-0000-0000-0000-000000000001',
    'requirements-active-product',
    'Requirements Active Product',
    6.3,
    5.5,
    205,
    true
  ),
  (
    '93300000-0000-0000-0000-000000000002',
    'requirements-inactive-product',
    'Requirements Inactive Product',
    7,
    6,
    300,
    false
  );

insert into public.master_item_products (master_item_id, product_id, is_active) values (
  '92300000-0000-0000-0000-000000000001',
  '93300000-0000-0000-0000-000000000001',
  false
);

insert into public.box_definitions (
  id, master_item_id, box_code, box_name, version, is_active
) values
  (
    '95300000-0000-0000-0000-000000000001',
    '92300000-0000-0000-0000-000000000001',
    'REQ-EDITABLE',
    'Requirements Editable',
    1,
    false
  ),
  (
    '95300000-0000-0000-0000-000000000002',
    '92300000-0000-0000-0000-000000000002',
    'REQ-OTHER-ITEM',
    'Requirements Other Item',
    1,
    false
  ),
  (
    '95300000-0000-0000-0000-000000000003',
    '92300000-0000-0000-0000-000000000001',
    'REQ-USED',
    'Requirements Used',
    1,
    false
  );

insert into public.packing_sessions (
  operator_id, master_item_id, box_definition_id, status
) values (
  '91300000-0000-0000-0000-000000000002',
  '92300000-0000-0000-0000-000000000001',
  '95300000-0000-0000-0000-000000000003',
  'draft'
);

select has_function(
  'public',
  'save_master_item_box_requirements',
  array['uuid', 'uuid', 'jsonb'],
  'master item box requirement RPC exists'
);

select set_config(
  'request.jwt.claim.sub',
  '91300000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select lives_ok(
  $$
    select public.save_master_item_box_requirements(
      '92300000-0000-0000-0000-000000000001',
      '95300000-0000-0000-0000-000000000001',
      '[{
        "name": "Layer 1",
        "requirements": [{
          "product_id": "93300000-0000-0000-0000-000000000001",
          "expected_qty": 3
        }]
      }]'::jsonb
    )
  $$,
  'admin saves a layer requirement'
);

select lives_ok(
  $$
    select public.save_master_item_box_requirements(
      '92300000-0000-0000-0000-000000000001',
      '95300000-0000-0000-0000-000000000001',
      '[{
        "name": "Layer 1",
        "requirements": [{
          "productId": "93300000-0000-0000-0000-000000000001",
          "expectedQty": 4
        }]
      }]'::jsonb
    )
  $$,
  'admin saves camelCase form requirements'
);

select is(
  (
    select is_active
    from public.master_item_products
    where master_item_id = '92300000-0000-0000-0000-000000000001'
      and product_id = '93300000-0000-0000-0000-000000000001'
  ),
  true,
  'saving reactivates an existing Product Mapping'
);

select is(
  (
    select layer.layer_no::text || ':' || layer.layer_name || ':' || requirement.expected_qty::text
    from public.box_layers layer
    join public.box_layer_requirements requirement on requirement.box_layer_id = layer.id
    where layer.box_definition_id = '95300000-0000-0000-0000-000000000001'
  ),
  '1:Layer 1:4',
  'camelCase requirements persist through the snake_case graph'
);

select is(
  (
    select count(*)::integer
    from public.audit_logs
    where action = 'master_item.box_requirements_updated'
      and entity_type = 'box_definition'
      and entity_id = '95300000-0000-0000-0000-000000000001'
  ),
  2,
  'each save is audited'
);

select set_config(
  'request.jwt.claim.sub',
  '91300000-0000-0000-0000-000000000002',
  true
);

select throws_ok(
  $$
    select public.save_master_item_box_requirements(
      '92300000-0000-0000-0000-000000000001',
      '95300000-0000-0000-0000-000000000001',
      '[]'::jsonb
    )
  $$,
  'P0001',
  'MASTER_ITEM_BOX_REQUIREMENTS_ADMIN_REQUIRED',
  'non-admin cannot save requirements'
);

select set_config(
  'request.jwt.claim.sub',
  '91300000-0000-0000-0000-000000000001',
  true
);

select throws_ok(
  $$
    select public.save_master_item_box_requirements(
      '92300000-0000-0000-0000-000000000002',
      '95300000-0000-0000-0000-000000000001',
      '[]'::jsonb
    )
  $$,
  'P0001',
  'MASTER_ITEM_BOX_DEFINITION_MISMATCH',
  'a different Master Item cannot save the Box Definition'
);

select throws_ok(
  $$
    select public.save_master_item_box_requirements(
      '92300000-0000-0000-0000-000000000001',
      '95300000-0000-0000-0000-000000000001',
      '[{
        "name": "Layer 1",
        "requirements": [{
          "product_id": "93300000-0000-0000-0000-000000000002",
          "expected_qty": 3
        }]
      }]'::jsonb
    )
  $$,
  'P0001',
  'MASTER_ITEM_BOX_REQUIREMENTS_PRODUCT_INVALID',
  'inactive Products are rejected'
);

select throws_ok(
  $$
    select public.save_master_item_box_requirements(
      '92300000-0000-0000-0000-000000000001',
      '95300000-0000-0000-0000-000000000001',
      (
        select jsonb_agg(
          jsonb_build_object(
            'name', 'Layer ' || layer_no,
            'requirements', jsonb_build_array(
              jsonb_build_object(
                'product_id', '93300000-0000-0000-0000-000000000001',
                'expected_qty', 1
              )
            )
          )
        )
        from generate_series(1, 11) as layer_no
      )
    )
  $$,
  'P0001',
  'MASTER_ITEM_BOX_REQUIREMENTS_INPUT_INVALID',
  'eleven layers are rejected'
);

select throws_ok(
  $$
    select public.save_master_item_box_requirements(
      '92300000-0000-0000-0000-000000000001',
      '95300000-0000-0000-0000-000000000003',
      '[{
        "name": "Layer 1",
        "requirements": [{
          "product_id": "93300000-0000-0000-0000-000000000001",
          "expected_qty": 3
        }]
      }]'::jsonb
    )
  $$,
  'P0001',
  'MASTER_ITEM_BOX_DEFINITION_IN_USE',
  'a Box Definition referenced by packing_sessions cannot be changed'
);

reset role;
set local role anon;

select throws_ok(
  $$
    select public.save_master_item_box_requirements(
      '92300000-0000-0000-0000-000000000001',
      '95300000-0000-0000-0000-000000000001',
      '[]'::jsonb
    )
  $$,
  '42501',
  'permission denied for function save_master_item_box_requirements',
  'anon has no execute privilege on the save RPC'
);

reset role;

select * from finish();

rollback;
