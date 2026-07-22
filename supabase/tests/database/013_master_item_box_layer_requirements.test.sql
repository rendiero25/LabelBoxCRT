begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(27);

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
) values (
  '92300000-0000-0000-0000-000000000001',
  'requirements-item-one',
  'REQUIREMENTS-PART-ONE',
  'Requirements Item One',
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

-- Mapping starts inactive so a successful save can prove it gets reactivated.
insert into public.master_item_products (master_item_id, product_id, is_active) values (
  '92300000-0000-0000-0000-000000000001',
  '93300000-0000-0000-0000-000000000001',
  false
);

insert into public.boxes (id, box_code, box_name, is_active) values (
  '95300000-0000-0000-0000-000000000001',
  'REQ-BOX',
  'Requirements Box',
  true
);

insert into public.box_layers (id, box_id, layer_no, layer_name, sort_order) values (
  '96300000-0000-0000-0000-000000000001',
  '95300000-0000-0000-0000-000000000001',
  1,
  'Layer 1',
  1
);

select has_function(
  'public', 'create_master_item_box', array['uuid', 'uuid', 'jsonb'],
  'create Master Item Box RPC exists'
);
select has_function(
  'public', 'save_master_item_box_requirements', array['uuid', 'uuid', 'jsonb'],
  'save Master Item Box requirements RPC exists'
);
select has_function(
  'public', 'publish_master_item_box', array['uuid'], 'publish Master Item Box RPC exists'
);
select has_function(
  'public', 'clone_master_item_box_version', array['uuid'], 'clone Master Item Box RPC exists'
);

select set_config('request.jwt.claim.sub', '91300000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$
    select public.create_master_item_box(
      '92300000-0000-0000-0000-000000000001',
      '95300000-0000-0000-0000-000000000001',
      '[{
        "box_layer_id": "96300000-0000-0000-0000-000000000001",
        "requirements": [{"product_id": "93300000-0000-0000-0000-000000000001", "expected_qty": 3}]
      }]'::jsonb
    )
  $$,
  'admin adopts a Box for a Master Item'
);

select is(
  (
    select requirement.expected_qty
    from public.box_layer_requirements requirement
    join public.master_item_boxes assignment on assignment.id = requirement.master_item_box_id
    where assignment.master_item_id = '92300000-0000-0000-0000-000000000001'
      and assignment.box_id = '95300000-0000-0000-0000-000000000001'
      and assignment.version = 1
  ),
  3,
  'the requirement quantity is persisted against the new assignment'
);

select is(
  (
    select is_active from public.master_item_products
    where master_item_id = '92300000-0000-0000-0000-000000000001'
      and product_id = '93300000-0000-0000-0000-000000000001'
  ),
  true,
  'adopting the box reactivates an existing inactive Product Mapping'
);

select is(
  (
    select count(*)::integer from public.audit_logs
    where action = 'master_item_box.created' and entity_type = 'master_item_box'
  ),
  1,
  'creating the assignment is audited'
);

select throws_ok(
  $$
    select public.create_master_item_box(
      '92300000-0000-0000-0000-000000000001',
      '95300000-0000-0000-0000-000000000001',
      '[{
        "box_layer_id": "96300000-0000-0000-0000-000000000001",
        "requirements": [{"product_id": "93300000-0000-0000-0000-000000000001", "expected_qty": 1}]
      }]'::jsonb
    )
  $$,
  'P0001',
  'MASTER_ITEM_BOX_EXISTS',
  'adopting the same Box twice for one Master Item at version 1 is rejected'
);

select lives_ok(
  $$
    select public.save_master_item_box_requirements(
      '92300000-0000-0000-0000-000000000001',
      (select id from public.master_item_boxes where box_id = '95300000-0000-0000-0000-000000000001' and version = 1),
      '[{
        "box_layer_id": "96300000-0000-0000-0000-000000000001",
        "requirements": [{"product_id": "93300000-0000-0000-0000-000000000001", "expected_qty": 4}]
      }]'::jsonb
    )
  $$,
  'admin edits the draft assignment requirements'
);

select is(
  (
    select requirement.expected_qty
    from public.box_layer_requirements requirement
    join public.master_item_boxes assignment on assignment.id = requirement.master_item_box_id
    where assignment.box_id = '95300000-0000-0000-0000-000000000001' and assignment.version = 1
  ),
  4,
  'saving replaces the requirement rather than duplicating it'
);

select throws_ok(
  $$
    select public.save_master_item_box_requirements(
      '92300000-0000-0000-0000-000000000001',
      (select id from public.master_item_boxes where box_id = '95300000-0000-0000-0000-000000000001' and version = 1),
      '[{
        "box_layer_id": "00000000-0000-0000-0000-000000000000",
        "requirements": [{"product_id": "93300000-0000-0000-0000-000000000001", "expected_qty": 1}]
      }]'::jsonb
    )
  $$,
  'P0001',
  'MASTER_ITEM_BOX_LAYER_NOT_ALLOWED',
  'a layer that does not belong to the assigned Box is rejected'
);

select throws_ok(
  $$
    select public.save_master_item_box_requirements(
      '92300000-0000-0000-0000-000000000001',
      (select id from public.master_item_boxes where box_id = '95300000-0000-0000-0000-000000000001' and version = 1),
      '[{
        "box_layer_id": "96300000-0000-0000-0000-000000000001",
        "requirements": [{"product_id": "93300000-0000-0000-0000-000000000002", "expected_qty": 1}]
      }]'::jsonb
    )
  $$,
  'P0001',
  'MASTER_ITEM_BOX_PRODUCT_NOT_ALLOWED',
  'an inactive Product is rejected'
);

select throws_ok(
  $$
    select public.save_master_item_box_requirements(
      '92300000-0000-0000-0000-000000000001',
      (select id from public.master_item_boxes where box_id = '95300000-0000-0000-0000-000000000001' and version = 1),
      (
        select jsonb_agg(
          jsonb_build_object(
            'box_layer_id', '96300000-0000-0000-0000-000000000001',
            'requirements', jsonb_build_array(
              jsonb_build_object('product_id', '93300000-0000-0000-0000-000000000001', 'expected_qty', 1)
            )
          )
        )
        from generate_series(1, 11)
      )
    )
  $$,
  'P0001',
  'MASTER_ITEM_BOX_INPUT_INVALID',
  'more than ten layer entries are rejected'
);

insert into public.packing_sessions (
  operator_id, master_item_id, master_item_box_id, status
) values (
  '91300000-0000-0000-0000-000000000002',
  '92300000-0000-0000-0000-000000000001',
  (select id from public.master_item_boxes where box_id = '95300000-0000-0000-0000-000000000001' and version = 1),
  'draft'
);

select throws_ok(
  $$
    select public.save_master_item_box_requirements(
      '92300000-0000-0000-0000-000000000001',
      (select id from public.master_item_boxes where box_id = '95300000-0000-0000-0000-000000000001' and version = 1),
      '[{
        "box_layer_id": "96300000-0000-0000-0000-000000000001",
        "requirements": [{"product_id": "93300000-0000-0000-0000-000000000001", "expected_qty": 5}]
      }]'::jsonb
    )
  $$,
  'P0001',
  'MASTER_ITEM_BOX_IN_USE',
  'an assignment referenced by packing_sessions cannot be changed'
);

select lives_ok(
  $$
    select public.clone_master_item_box_version(
      (select id from public.master_item_boxes where box_id = '95300000-0000-0000-0000-000000000001' and version = 1)
    )
  $$,
  'admin clones a used assignment into a new draft version'
);

select is(
  (
    select requirement.expected_qty
    from public.box_layer_requirements requirement
    join public.master_item_boxes assignment on assignment.id = requirement.master_item_box_id
    where assignment.box_id = '95300000-0000-0000-0000-000000000001' and assignment.version = 2
  ),
  4,
  'the clone copies the source requirements'
);

select lives_ok(
  $$
    select public.publish_master_item_box(
      (select id from public.master_item_boxes where box_id = '95300000-0000-0000-0000-000000000001' and version = 2)
    )
  $$,
  'admin publishes the new draft version'
);

select is(
  (
    select string_agg(version::text || ':' || is_active::text, ',' order by version)
    from public.master_item_boxes
    where box_id = '95300000-0000-0000-0000-000000000001'
  ),
  '1:false,2:true',
  'publishing activates version two and deactivates version one'
);

select set_config('request.jwt.claim.sub', '91300000-0000-0000-0000-000000000002', true);

select throws_ok(
  $$
    select public.create_master_item_box(
      '92300000-0000-0000-0000-000000000001',
      '95300000-0000-0000-0000-000000000001',
      '[]'::jsonb
    )
  $$,
  'P0001', 'MASTER_ITEM_BOX_ADMIN_REQUIRED', 'non-admin cannot create an assignment'
);
select throws_ok(
  $$
    select public.save_master_item_box_requirements(
      '92300000-0000-0000-0000-000000000001',
      (select id from public.master_item_boxes where box_id = '95300000-0000-0000-0000-000000000001' and version = 2),
      '[]'::jsonb
    )
  $$,
  'P0001', 'MASTER_ITEM_BOX_ADMIN_REQUIRED', 'non-admin cannot save requirements'
);
select throws_ok(
  $$
    select public.publish_master_item_box(
      (select id from public.master_item_boxes where box_id = '95300000-0000-0000-0000-000000000001' and version = 2)
    )
  $$,
  'P0001', 'MASTER_ITEM_BOX_ADMIN_REQUIRED', 'non-admin cannot publish an assignment'
);
select throws_ok(
  $$
    select public.clone_master_item_box_version(
      (select id from public.master_item_boxes where box_id = '95300000-0000-0000-0000-000000000001' and version = 2)
    )
  $$,
  'P0001', 'MASTER_ITEM_BOX_ADMIN_REQUIRED', 'non-admin cannot clone an assignment'
);

reset role;
set local role anon;

select throws_ok(
  $$ select public.create_master_item_box('92300000-0000-0000-0000-000000000001', '95300000-0000-0000-0000-000000000001', '[]'::jsonb) $$,
  '42501', 'permission denied for function create_master_item_box',
  'anon has no execute privilege on create_master_item_box'
);
select throws_ok(
  $$ select public.save_master_item_box_requirements('92300000-0000-0000-0000-000000000001', '95300000-0000-0000-0000-000000000001', '[]'::jsonb) $$,
  '42501', 'permission denied for function save_master_item_box_requirements',
  'anon has no execute privilege on save_master_item_box_requirements'
);
select throws_ok(
  $$ select public.publish_master_item_box('95300000-0000-0000-0000-000000000001') $$,
  '42501', 'permission denied for function publish_master_item_box',
  'anon has no execute privilege on publish_master_item_box'
);
select throws_ok(
  $$ select public.clone_master_item_box_version('95300000-0000-0000-0000-000000000001') $$,
  '42501', 'permission denied for function clone_master_item_box_version',
  'anon has no execute privilege on clone_master_item_box_version'
);

reset role;

select * from finish();

rollback;
