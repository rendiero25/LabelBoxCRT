begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(36);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '95100000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', 'phase5-operator@example.test',
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '95100000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'phase5-other-operator@example.test',
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.profiles (id, display_name, role, is_active) values
  ('95100000-0000-0000-0000-000000000001', 'Phase 5 Operator', 'operator', true),
  ('95100000-0000-0000-0000-000000000002', 'Phase 5 Other Operator', 'operator', true);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, is_active
) values
  (
    '96100000-0000-0000-0000-000000000001',
    'phase5-item',
    'PHASE5-PART',
    'Phase 5 Part',
    'Pcs',
    100,
    true
  ),
  (
    '96100000-0000-0000-0000-000000000002',
    'phase5-other-item',
    'PHASE5-OTHER',
    'Phase 5 Other Part',
    'Pcs',
    100,
    true
  );

insert into public.products (
  id, product_code, part_name, outer_diameter, inner_diameter, length, is_active
) values
  (
    '97100000-0000-0000-0000-000000000001',
    'phase5-good', 'Phase 5 Good', 5.5, 6.3, 205, true
  ),
  (
    '97100000-0000-0000-0000-000000000002',
    'phase5-unmapped', 'Phase 5 Unmapped', 9.9, 8.8, 7.7, true
  ),
  (
    '97100000-0000-0000-0000-000000000003',
    'phase5-not-required', 'Phase 5 Not Required', 10, 9, 8, true
  ),
  (
    '97100000-0000-0000-0000-000000000004',
    'phase5-other-required', 'Phase 5 Other Required', 12, 11, 10, true
  );

insert into public.master_item_products (master_item_id, product_id, is_active) values
  ('96100000-0000-0000-0000-000000000001', '97100000-0000-0000-0000-000000000001', true),
  ('96100000-0000-0000-0000-000000000001', '97100000-0000-0000-0000-000000000003', true),
  ('96100000-0000-0000-0000-000000000001', '97100000-0000-0000-0000-000000000004', true);

insert into public.box_definitions (
  id, master_item_id, box_code, box_name, version, is_active
) values
  (
    '98100000-0000-0000-0000-000000000001',
    '96100000-0000-0000-0000-000000000001',
    'B101', 'Phase 5 B101', 1, true
  ),
  (
    '98100000-0000-0000-0000-000000000002',
    '96100000-0000-0000-0000-000000000001',
    'B102', 'Phase 5 Overflow', 1, true
  );

insert into public.box_layers (
  id, box_definition_id, layer_no, layer_name, sort_order, is_active
) values
  (
    '98200000-0000-0000-0000-000000000001',
    '98100000-0000-0000-0000-000000000001', 1, 'Layer 1', 1, true
  ),
  (
    '98200000-0000-0000-0000-000000000002',
    '98100000-0000-0000-0000-000000000001', 2, 'Layer 2', 2, true
  ),
  (
    '98200000-0000-0000-0000-000000000003',
    '98100000-0000-0000-0000-000000000002', 1, 'Layer 1', 1, true
  ),
  (
    '98200000-0000-0000-0000-000000000004',
    '98100000-0000-0000-0000-000000000002', 2, 'Layer 2', 2, true
  );

insert into public.box_layer_requirements (
  box_layer_id, product_id, expected_qty, sort_order
) values
  ('98200000-0000-0000-0000-000000000001', '97100000-0000-0000-0000-000000000001', 3, 1),
  ('98200000-0000-0000-0000-000000000002', '97100000-0000-0000-0000-000000000001', 5, 1),
  ('98200000-0000-0000-0000-000000000003', '97100000-0000-0000-0000-000000000001', 1, 1),
  ('98200000-0000-0000-0000-000000000004', '97100000-0000-0000-0000-000000000004', 1, 1);

select has_function(
  'public',
  'start_packing_session',
  array['uuid', 'uuid'],
  'start packing-session RPC exists'
);

select has_function(
  'public',
  'accept_packing_scan',
  array['uuid', 'text', 'text', 'text', 'text'],
  'accept packing-scan RPC exists'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_index index_definition
    join pg_catalog.pg_class index_relation on index_relation.oid = index_definition.indexrelid
    join pg_catalog.pg_namespace index_schema on index_schema.oid = index_relation.relnamespace
    where index_schema.nspname = 'public'
      and index_relation.relname = 'packing_session_scans_accepted_label_uid_idx'
      and index_definition.indisunique
  ),
  'global accepted-label unique index protects same-label parallel scans'
);

select ok(
  position(
    'for update' in lower(
      pg_get_functiondef(
        'public.accept_packing_scan(uuid, text, text, text, text)'::regprocedure
      )
    )
  ) > 0,
  'accept RPC locks its session before layer and completion progress decisions'
);

select set_config(
  'request.jwt.claim.sub',
  '95100000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select throws_ok(
  $$
    select public.start_packing_session(
      '96100000-0000-0000-0000-000000000099',
      '98100000-0000-0000-0000-000000000001'
    )
  $$,
  'P0001',
  'MASTER_ITEM_NOT_ACTIVE',
  'start rejects a missing or inactive Master Item'
);

select throws_ok(
  $$
    select public.start_packing_session(
      '96100000-0000-0000-0000-000000000002',
      '98100000-0000-0000-0000-000000000001'
    )
  $$,
  'P0001',
  'BOX_DEFINITION_NOT_ACTIVE_OR_MISMATCH',
  'start requires the explicitly selected active Box Definition to belong to its Master Item'
);

create temporary table phase5_b101_session as
select *
from public.start_packing_session(
  '96100000-0000-0000-0000-000000000001',
  '98100000-0000-0000-0000-000000000001'
);
grant select on phase5_b101_session to public;

select is(
  (select status::text from phase5_b101_session),
  'scanning',
  'start creates a scanning session'
);

select is(
  (
    select box_definition_id::text || ':' || total_expected_qty::text || ':' || accepted_qty::text
    from phase5_b101_session
  ),
  '98100000-0000-0000-0000-000000000001:8:0',
  'start snapshots B101 and calculates its expected total'
);

select is(
  (
    select version
    from public.packing_sessions session
    join phase5_b101_session started on started.session_id = session.id
  ),
  1,
  'start snapshots the active box version on the session'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.audit_logs audit
    join phase5_b101_session started on started.session_id::text = audit.entity_id
    where audit.action = 'packing_session.started'
  ),
  1,
  'start is audited'
);

set local role authenticated;

select throws_ok(
  $$
    insert into public.packing_sessions (
      operator_id, master_item_id, box_definition_id, status
    ) values (
      '95100000-0000-0000-0000-000000000001',
      '96100000-0000-0000-0000-000000000001',
      '98100000-0000-0000-0000-000000000001',
      'scanning'
    )
  $$,
  '42501',
  'permission denied for table packing_sessions',
  'operators cannot bypass the session RPC with direct DML'
);

select is(
  (
    select result::text || ':' || error_code
    from public.accept_packing_scan(
      (select session_id from phase5_b101_session),
      null,
      'phase5-hash-missing-uid',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  ),
  'invalid:LABEL_UID_MISSING',
  'scan requires a real label UID'
);

select is(
  (
    select count(*)::integer
    from public.packing_session_scans scan
    join phase5_b101_session started on started.session_id = scan.packing_session_id
    where scan.result = 'invalid' and scan.error_code = 'LABEL_UID_MISSING'
  ),
  1,
  'missing UID rejection is persisted'
);

select is(
  (
    select error_code
    from public.accept_packing_scan(
      (select session_id from phase5_b101_session),
      'phase5-size-missing',
      'phase5-hash-size-missing',
      'Unknown size',
      '1x2x3'
    )
  ),
  'PRODUCT_SIZE_NOT_FOUND',
  'unknown Size is rejected safely'
);

select is(
  (
    select error_code
    from public.accept_packing_scan(
      (select session_id from phase5_b101_session),
      'phase5-unmapped',
      'phase5-hash-unmapped',
      '9.9 x 8.8 x 7.7',
      '9.9x8.8x7.7'
    )
  ),
  'PRODUCT_NOT_ALLOWED_FOR_PART',
  'Size must have an active Master Item product mapping'
);

select is(
  (
    select error_code
    from public.accept_packing_scan(
      (select session_id from phase5_b101_session),
      'phase5-not-required',
      'phase5-hash-not-required',
      '10 x 9 x 8',
      '10x9x8'
    )
  ),
  'PRODUCT_NOT_REQUIRED_IN_BOX',
  'mapped product not required by B101 is rejected safely'
);

select is(
  (
    select result::text || ':' || box_layer_id::text || ':' || layer_accepted_qty::text || ':' || layer_expected_qty::text
    from public.accept_packing_scan(
      (select session_id from phase5_b101_session),
      'phase5-b101-uid-1',
      'phase5-hash-b101-uid-1',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  ),
  'accepted:98200000-0000-0000-0000-000000000001:1:3',
  'first B101 scan is assigned to layer 1'
);

select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase5_b101_session),
      'phase5-b101-uid-2',
      'phase5-hash-b101-uid-2',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  $$,
  'second rapid B101 scan is accepted'
);

select is(
  (
    select box_layer_id::text || ':' || layer_accepted_qty::text || ':' || total_accepted_qty::text
    from public.accept_packing_scan(
      (select session_id from phase5_b101_session),
      'phase5-b101-uid-3',
      'phase5-hash-b101-uid-3',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  ),
  '98200000-0000-0000-0000-000000000001:3:3',
  'third scan fills layer 1 deterministically'
);

select is(
  (
    select box_layer_id::text || ':' || layer_accepted_qty::text || ':' || layer_expected_qty::text
    from public.accept_packing_scan(
      (select session_id from phase5_b101_session),
      'phase5-b101-uid-4',
      'phase5-hash-b101-uid-4',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  ),
  '98200000-0000-0000-0000-000000000002:1:5',
  'fourth scan moves to layer 2'
);

create temporary table phase5_second_session as
select *
from public.start_packing_session(
  '96100000-0000-0000-0000-000000000001',
  '98100000-0000-0000-0000-000000000001'
);

select is(
  (
    select result::text || ':' || error_code
    from public.accept_packing_scan(
      (select session_id from phase5_second_session),
      'phase5-b101-uid-1',
      'phase5-hash-duplicate-global',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  ),
  'duplicate:LABEL_ALREADY_SCANNED',
  'accepted UID is rejected globally across sessions'
);

select is(
  (
    select count(*)::integer
    from public.packing_session_scans scan
    join phase5_second_session started on started.session_id = scan.packing_session_id
    where scan.label_uid = 'phase5-b101-uid-1'
      and scan.result = 'duplicate'
      and scan.error_code = 'LABEL_ALREADY_SCANNED'
  ),
  1,
  'global duplicate outcome is persisted'
);

create temporary table phase5_overflow_session as
select *
from public.start_packing_session(
  '96100000-0000-0000-0000-000000000001',
  '98100000-0000-0000-0000-000000000002'
);

select is(
  (
    select session_status::text
    from public.accept_packing_scan(
      (select session_id from phase5_overflow_session),
      'phase5-overflow-uid-1',
      'phase5-hash-overflow-uid-1',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  ),
  'scanning',
  'session remains scanning while another B102 requirement is incomplete'
);

select is(
  (
    select result::text || ':' || error_code
    from public.accept_packing_scan(
      (select session_id from phase5_overflow_session),
      'phase5-overflow-uid-2',
      'phase5-hash-overflow-uid-2',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  ),
  'over_qty:LAYER_QUANTITY_FULL',
  'full layer rejects an over-quantity race-safe scan'
);

select is(
  (
    select count(*)::integer
    from public.packing_session_scans scan
    join phase5_overflow_session started on started.session_id = scan.packing_session_id
    where scan.result = 'over_qty' and scan.error_code = 'LAYER_QUANTITY_FULL'
  ),
  1,
  'over-quantity rejection is persisted'
);

select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase5_b101_session),
      'phase5-b101-uid-5',
      'phase5-hash-b101-uid-5',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  $$,
  'fifth B101 scan is accepted'
);

select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase5_b101_session),
      'phase5-b101-uid-6',
      'phase5-hash-b101-uid-6',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  $$,
  'sixth B101 scan is accepted'
);

select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase5_b101_session),
      'phase5-b101-uid-7',
      'phase5-hash-b101-uid-7',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  $$,
  'seventh B101 scan is accepted'
);

select is(
  (
    select session_status::text || ':' || total_accepted_qty::text || ':' || total_expected_qty::text
    from public.accept_packing_scan(
      (select session_id from phase5_b101_session),
      'phase5-b101-uid-8',
      'phase5-hash-b101-uid-8',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  ),
  'ready_to_finalize:8:8',
  'eighth B101 scan transitions the session to ready_to_finalize'
);

select is(
  (
    select string_agg(layer_assignment, ',' order by sort_order)
    from (
      select
        layer.sort_order,
        layer.layer_no::text || ':' || count(scan.id)::text as layer_assignment
      from public.box_layers layer
      left join public.packing_session_scans scan
        on scan.box_layer_id = layer.id
        and scan.result = 'accepted'
        and scan.packing_session_id = (select session_id from phase5_b101_session)
      where layer.box_definition_id = '98100000-0000-0000-0000-000000000001'
      group by layer.id, layer.layer_no, layer.sort_order
    ) as layer_progress
  ),
  '1:3,2:5',
  'B101 preserves the required 3 + 5 layer assignment'
);

select is(
  (
    select scanned_part_no
    from public.packing_session_scans scan
    join phase5_b101_session started on started.session_id = scan.packing_session_id
    where scan.label_uid = 'phase5-b101-uid-8'
  ),
  'PHASE5-PART',
  'scan Part No is derived from the selected Master Item, not the QR input'
);

select throws_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase5_b101_session),
      'phase5-after-ready',
      'phase5-hash-after-ready',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  $$,
  'P0001',
  'SESSION_NOT_ACCEPTING_SCAN',
  'ready session refuses additional scans'
);

select set_config(
  'request.jwt.claim.sub',
  '95100000-0000-0000-0000-000000000002',
  true
);

select throws_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase5_b101_session),
      'phase5-other-operator',
      'phase5-hash-other-operator',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  $$,
  'P0001',
  'PACKING_SESSION_OPERATOR_MISMATCH',
  'another operator cannot submit to the session'
);

select set_config(
  'request.jwt.claim.sub',
  '95100000-0000-0000-0000-000000000001',
  true
);

reset role;

select is(
  (
    select count(*)::integer
    from public.audit_logs audit
    join phase5_b101_session started on started.session_id::text = audit.entity_id
    where audit.action = 'packing_scan.accepted'
  ),
  8,
  'accepted B101 scans are audited without raw UID values'
);

reset role;
set local role anon;

select throws_ok(
  $$
    select public.start_packing_session(
      '96100000-0000-0000-0000-000000000001',
      '98100000-0000-0000-0000-000000000001'
    )
  $$,
  '42501',
  'permission denied for function start_packing_session',
  'anon has no execute privilege for starting sessions'
);

select throws_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase5_b101_session),
      'phase5-anon',
      'phase5-hash-anon',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  $$,
  '42501',
  'permission denied for function accept_packing_scan',
  'anon has no execute privilege for accepting scans'
);

reset role;

select * from finish();

rollback;
