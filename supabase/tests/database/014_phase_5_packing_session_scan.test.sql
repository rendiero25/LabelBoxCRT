begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(31);

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
  ('95100000-0000-0000-0000-000000000001', 'Phase 5 Operator', 'user', true),
  ('95100000-0000-0000-0000-000000000002', 'Phase 5 Other Operator', 'user', true);

insert into public.suppliers (id, supplier_code, supplier_name, is_active) values
  ('95900000-0000-0000-0000-000000000001', 'PH5SUP', 'Phase 5 Supplier', true),
  ('95900000-0000-0000-0000-000000000002', 'PH5OFF', 'Phase 5 Inactive Supplier', false);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id, is_active
) values
  (
    '96100000-0000-0000-0000-000000000001',
    'phase5-item',
    'PHASE5-PART',
    'Phase 5 Part',
    'Pcs',
    100,
    '95900000-0000-0000-0000-000000000001',
    true
  ),
  (
    '96100000-0000-0000-0000-000000000002',
    'phase5-other-item',
    'PHASE5-OTHER',
    'Phase 5 Other Part',
    'Pcs',
    100,
    '95900000-0000-0000-0000-000000000001',
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

-- Box shape (B101, B102), owned directly by the Phase 5 Master Item as
-- slots 1 and 2.
insert into public.boxes (id, master_item_id, box_no, box_code, box_name) values
  (
    '98100000-0000-0000-0000-000000000001',
    '96100000-0000-0000-0000-000000000001', 1, 'B101-T5', 'Phase 5 B101'
  ),
  (
    '98100000-0000-0000-0000-000000000002',
    '96100000-0000-0000-0000-000000000001', 2, 'B102-T5', 'Phase 5 Overflow'
  ),
  -- Box dengan satu layer yang memuat dua produk berbeda. Bentuk inilah yang
  -- dipakai Master Item nyata, dan sempat menolak produk kedua karena hitungan
  -- kuota dilakukan per layer, bukan per produk.
  (
    '98100000-0000-0000-0000-000000000003',
    '96100000-0000-0000-0000-000000000001', 3, 'B103-T5', 'Phase 5 Mixed Layer'
  );

insert into public.box_layers (
  id, box_id, layer_no, layer_name, sort_order
) values
  (
    '98200000-0000-0000-0000-000000000001',
    '98100000-0000-0000-0000-000000000001', 1, 'Layer 1', 1
  ),
  (
    '98200000-0000-0000-0000-000000000002',
    '98100000-0000-0000-0000-000000000001', 2, 'Layer 2', 2
  ),
  (
    '98200000-0000-0000-0000-000000000003',
    '98100000-0000-0000-0000-000000000002', 1, 'Layer 1', 1
  ),
  (
    '98200000-0000-0000-0000-000000000004',
    '98100000-0000-0000-0000-000000000002', 2, 'Layer 2', 2
  ),
  (
    '98200000-0000-0000-0000-000000000005',
    '98100000-0000-0000-0000-000000000003', 1, 'Layer 1', 1
  );

insert into public.box_layer_requirements (
  box_layer_id, product_id, expected_qty, sort_order
) values
  (
    '98200000-0000-0000-0000-000000000001', '97100000-0000-0000-0000-000000000001', 3, 1
  ),
  (
    '98200000-0000-0000-0000-000000000002', '97100000-0000-0000-0000-000000000001', 5, 1
  ),
  (
    '98200000-0000-0000-0000-000000000003', '97100000-0000-0000-0000-000000000001', 1, 1
  ),
  (
    '98200000-0000-0000-0000-000000000004', '97100000-0000-0000-0000-000000000004', 1, 1
  ),
  (
    '98200000-0000-0000-0000-000000000005', '97100000-0000-0000-0000-000000000001', 1, 1
  ),
  (
    '98200000-0000-0000-0000-000000000005', '97100000-0000-0000-0000-000000000004', 1, 2
  );

-- start_packing_session was dropped (Task 13): it auto-created this Delivery
-- Number and the packing_sessions rows below. Both are now inserted directly
-- as fixture data; accept_packing_scan reads packing_sessions by id and does
-- not care how the row got there.
insert into public.delivery_numbers (
  id, supplier_id, delivery_number, delivery_date, status, created_by
) values (
  '95800000-0000-0000-0000-000000000001', '95900000-0000-0000-0000-000000000001',
  'DN-PHASE5-TEST', date '2026-05-15', 'active', '95100000-0000-0000-0000-000000000001'
);

insert into public.packing_sessions (
  id, operator_id, master_item_id, box_id, delivery_number_id,
  qty_delivery, lot_no, status
) values
  (
    'a1400000-0000-0000-0000-000000000001',
    '95100000-0000-0000-0000-000000000001',
    '96100000-0000-0000-0000-000000000001',
    '98100000-0000-0000-0000-000000000001',
    '95800000-0000-0000-0000-000000000001',
    40, 'LOT-P5-A', 'scanning'
  ),
  (
    'a1400000-0000-0000-0000-000000000002',
    '95100000-0000-0000-0000-000000000001',
    '96100000-0000-0000-0000-000000000001',
    '98100000-0000-0000-0000-000000000001',
    '95800000-0000-0000-0000-000000000001',
    40, 'LOT-P5-B', 'scanning'
  ),
  (
    'a1400000-0000-0000-0000-000000000003',
    '95100000-0000-0000-0000-000000000001',
    '96100000-0000-0000-0000-000000000001',
    '98100000-0000-0000-0000-000000000002',
    '95800000-0000-0000-0000-000000000001',
    40, 'LOT-P5-C', 'scanning'
  ),
  (
    'a1400000-0000-0000-0000-000000000004',
    '95100000-0000-0000-0000-000000000001',
    '96100000-0000-0000-0000-000000000001',
    '98100000-0000-0000-0000-000000000003',
    '95800000-0000-0000-0000-000000000001',
    40, 'LOT-P5-D', 'scanning'
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
      and index_relation.relname =
        'packing_session_scans_accepted_label_uid_per_batch_idx'
      and index_definition.indisunique
  ),
  'per-batch accepted-label unique index protects same-label parallel scans'
);

-- Pagarnya per batch, bukan global: QR produk yang sama sah muncul lagi pada
-- kiriman berikutnya, tetapi tidak boleh masuk dua box dalam kiriman yang sama.
select is(
  (
    select array_agg(attribute.attname::text order by attribute.attnum)
    from pg_catalog.pg_index index_definition
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_definition.indexrelid
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid = index_definition.indrelid
      and attribute.attnum = any(index_definition.indkey)
    where index_relation.relname =
      'packing_session_scans_accepted_label_uid_per_batch_idx'
  ),
  array['label_uid', 'label_box_batch_id'],
  'keunikan label dikunci bersama batch pemiliknya'
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
    insert into public.packing_sessions (
      operator_id, master_item_id, box_id, status
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
      'a1400000-0000-0000-0000-000000000001',
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
    where scan.packing_session_id = 'a1400000-0000-0000-0000-000000000001'
      and scan.result = 'invalid' and scan.error_code = 'LABEL_UID_MISSING'
  ),
  1,
  'missing UID rejection is persisted'
);

select is(
  (
    select error_code
    from public.accept_packing_scan(
      'a1400000-0000-0000-0000-000000000001',
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
      'a1400000-0000-0000-0000-000000000001',
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
      'a1400000-0000-0000-0000-000000000001',
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
      'a1400000-0000-0000-0000-000000000001',
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
      'a1400000-0000-0000-0000-000000000001',
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
      'a1400000-0000-0000-0000-000000000001',
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
      'a1400000-0000-0000-0000-000000000001',
      'phase5-b101-uid-4',
      'phase5-hash-b101-uid-4',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  ),
  '98200000-0000-0000-0000-000000000002:1:5',
  'fourth scan moves to layer 2'
);

select is(
  (
    select result::text || ':' || error_code
    from public.accept_packing_scan(
      'a1400000-0000-0000-0000-000000000002',
      'phase5-b101-uid-1',
      'phase5-hash-duplicate-global',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  ),
  'duplicate:LABEL_ALREADY_SCANNED',
  'accepted UID is rejected across sessions of the same batch'
);

select is(
  (
    select count(*)::integer
    from public.packing_session_scans scan
    where scan.packing_session_id = 'a1400000-0000-0000-0000-000000000002'
      and scan.label_uid = 'phase5-b101-uid-1'
      and scan.result = 'duplicate'
      and scan.error_code = 'LABEL_ALREADY_SCANNED'
  ),
  1,
  'duplicate outcome is persisted'
);

select is(
  (
    select session_status::text
    from public.accept_packing_scan(
      'a1400000-0000-0000-0000-000000000003',
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
      'a1400000-0000-0000-0000-000000000003',
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
    where scan.packing_session_id = 'a1400000-0000-0000-0000-000000000003'
      and scan.result = 'over_qty' and scan.error_code = 'LAYER_QUANTITY_FULL'
  ),
  1,
  'over-quantity rejection is persisted'
);

select lives_ok(
  $$
    select public.accept_packing_scan(
      'a1400000-0000-0000-0000-000000000001',
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
      'a1400000-0000-0000-0000-000000000001',
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
      'a1400000-0000-0000-0000-000000000001',
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
      'a1400000-0000-0000-0000-000000000001',
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
        and scan.packing_session_id = 'a1400000-0000-0000-0000-000000000001'
      where layer.box_id = '98100000-0000-0000-0000-000000000001'
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
    where scan.packing_session_id = 'a1400000-0000-0000-0000-000000000001'
      and scan.label_uid = 'phase5-b101-uid-8'
  ),
  'PHASE5-PART',
  'scan Part No is derived from the selected Master Item, not the QR input'
);

select throws_ok(
  $$
    select public.accept_packing_scan(
      'a1400000-0000-0000-0000-000000000001',
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
      'a1400000-0000-0000-0000-000000000001',
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

-- Satu layer memuat dua produk berbeda, masing-masing butuh satu keping.
-- Kuota harus dihitung per produk: menghitung per layer membuat produk kedua
-- ditolak LAYER_QUANTITY_FULL padahal belum pernah discan.
select is(
  (
    select result::text
    from public.accept_packing_scan(
      'a1400000-0000-0000-0000-000000000004',
      'phase5-mixed-first',
      'phase5-hash-mixed-first',
      '5.5 x 6.3 x 205',
      '5.5x6.3x205'
    )
  ),
  'accepted',
  'first product of a shared layer is accepted'
);

select is(
  (
    select result::text || ':' || coalesce(error_code, '-')
    from public.accept_packing_scan(
      'a1400000-0000-0000-0000-000000000004',
      'phase5-mixed-second',
      'phase5-hash-mixed-second',
      '12 x 11 x 10',
      '12x11x10'
    )
  ),
  'accepted:-',
  'second product of the same layer is still accepted'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.audit_logs audit
    where audit.action = 'packing_scan.accepted'
      and audit.entity_id = 'a1400000-0000-0000-0000-000000000001'
  ),
  8,
  'accepted B101 scans are audited without raw UID values'
);

reset role;
set local role anon;

select throws_ok(
  $$
    select public.accept_packing_scan(
      'a1400000-0000-0000-0000-000000000001',
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
