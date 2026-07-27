-- Phase 6 finalize RPC: global sequence, label reference formula, idempotent
-- replay under concurrent/duplicate finalize calls, Delivery Number
-- validation, and audit coverage. See
-- docs/superpowers/specs/2026-07-21-phase-6-finalize-design.md for the
-- approved contract this test verifies against.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(41);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    'a6100000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', 'phase6-operator@example.test',
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    'a6100000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', 'phase6-other-operator@example.test',
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.profiles (id, display_name, role, is_active) values
  ('a6100000-0000-0000-0000-000000000001', 'Phase 6 Operator', 'operator', true),
  ('a6100000-0000-0000-0000-000000000002', 'Phase 6 Other Operator', 'operator', true);

insert into public.suppliers (id, supplier_code, supplier_name, is_active) values
  ('a6700000-0000-0000-0000-000000000001', 'PH6SUP', 'Phase 6 Supplier', true);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, supplier_id, is_active
) values (
  'a6200000-0000-0000-0000-000000000001',
  'phase6-item', 'PHASE6-PART', 'Phase 6 Part', 'Pcs', 40,
  'a6700000-0000-0000-0000-000000000001', true
);

insert into public.products (
  id, product_code, part_name, outer_diameter, inner_diameter, length, is_active
) values (
  'a6300000-0000-0000-0000-000000000001',
  'phase6-good', 'Phase 6 Good', 5.5, 6.3, 205, true
);

insert into public.master_item_products (master_item_id, product_id, is_active) values
  ('a6200000-0000-0000-0000-000000000001', 'a6300000-0000-0000-0000-000000000001', true);

insert into public.boxes (id, master_item_id, box_no, box_code, box_name) values (
  'a6400000-0000-0000-0000-000000000001',
  'a6200000-0000-0000-0000-000000000001', 1, 'B101-T6', 'Phase 6 B101'
);

insert into public.box_layers (
  id, box_id, layer_no, layer_name, sort_order
) values
  (
    'a6500000-0000-0000-0000-000000000001',
    'a6400000-0000-0000-0000-000000000001', 1, 'Layer 1', 1
  ),
  (
    'a6500000-0000-0000-0000-000000000002',
    'a6400000-0000-0000-0000-000000000001', 2, 'Layer 2', 2
  );

insert into public.box_layer_requirements (
  box_layer_id, product_id, expected_qty, sort_order
) values
  (
    'a6500000-0000-0000-0000-000000000001', 'a6300000-0000-0000-0000-000000000001', 3, 1
  ),
  (
    'a6500000-0000-0000-0000-000000000002', 'a6300000-0000-0000-0000-000000000001', 5, 1
  );

insert into public.delivery_numbers (
  id, supplier_id, delivery_number, delivery_date, status, created_by
) values
  (
    'a6800000-0000-0000-0000-000000000001', 'a6700000-0000-0000-0000-000000000001',
    'DN-PHASE6-ACTIVE', date '2026-05-15', 'active', 'a6100000-0000-0000-0000-000000000001'
  ),
  (
    'a6800000-0000-0000-0000-000000000005', 'a6700000-0000-0000-0000-000000000001',
    'DN-PHASE6-LATER', date '2026-06-20', 'active', 'a6100000-0000-0000-0000-000000000001'
  );

select has_function(
  'public',
  'finalize_packing_session',
  array['uuid'],
  'finalize_packing_session RPC takes only the session id'
);

select has_sequence(
  'public',
  'print_job_sequence',
  'global print job sequence exists'
);

select ok(
  not has_sequence_privilege('anon', 'public.print_job_sequence', 'USAGE'),
  'anon has no usage privilege on the print job sequence'
);

select ok(
  not has_sequence_privilege('authenticated', 'public.print_job_sequence', 'USAGE'),
  'authenticated has no direct usage privilege on the print job sequence (only via the RPC)'
);

select ok(
  not has_function_privilege(
    'anon', 'public.finalize_packing_session(uuid)', 'EXECUTE'
  ),
  'anon has no execute privilege on finalize_packing_session'
);

select set_config(
  'request.jwt.claim.sub',
  'a6100000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

-- Session A: driven all the way to ready_to_finalize (3 + 5 = 8 accepted).
create temporary table phase6_session_a as
select *
from public.start_packing_session(
  'a6200000-0000-0000-0000-000000000001',
  'a6400000-0000-0000-0000-000000000001',
  'a6700000-0000-0000-0000-000000000001',
  date '2026-05-15',
  25,
  'LOT-P6-A'
);
grant select on phase6_session_a to public;

select is(
  (select status::text from phase6_session_a),
  'scanning',
  'session A starts in scanning status'
);

select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase6_session_a),
      'phase6-a-uid-1', 'phase6-a-hash-1', '5.5 x 6.3 x 205', '5.5x6.3x205'
    )
  $$,
  'session A scan 1 accepted'
);
select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase6_session_a),
      'phase6-a-uid-2', 'phase6-a-hash-2', '5.5 x 6.3 x 205', '5.5x6.3x205'
    )
  $$,
  'session A scan 2 accepted'
);
select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase6_session_a),
      'phase6-a-uid-3', 'phase6-a-hash-3', '5.5 x 6.3 x 205', '5.5x6.3x205'
    )
  $$,
  'session A scan 3 accepted'
);
select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase6_session_a),
      'phase6-a-uid-4', 'phase6-a-hash-4', '5.5 x 6.3 x 205', '5.5x6.3x205'
    )
  $$,
  'session A scan 4 accepted'
);
select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase6_session_a),
      'phase6-a-uid-5', 'phase6-a-hash-5', '5.5 x 6.3 x 205', '5.5x6.3x205'
    )
  $$,
  'session A scan 5 accepted'
);
select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase6_session_a),
      'phase6-a-uid-6', 'phase6-a-hash-6', '5.5 x 6.3 x 205', '5.5x6.3x205'
    )
  $$,
  'session A scan 6 accepted'
);
select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase6_session_a),
      'phase6-a-uid-7', 'phase6-a-hash-7', '5.5 x 6.3 x 205', '5.5x6.3x205'
    )
  $$,
  'session A scan 7 accepted'
);

select is(
  (
    select session_status::text || ':' || total_accepted_qty::text || ':' || total_expected_qty::text
    from public.accept_packing_scan(
      (select session_id from phase6_session_a),
      'phase6-a-uid-8', 'phase6-a-hash-8', '5.5 x 6.3 x 205', '5.5x6.3x205'
    )
  ),
  'ready_to_finalize:8:8',
  'eighth session A scan transitions to ready_to_finalize'
);

-- Non-owner and anon are rejected before any sequence value is consumed.
select set_config(
  'request.jwt.claim.sub',
  'a6100000-0000-0000-0000-000000000002',
  true
);

select throws_ok(
  $$
    select public.finalize_packing_session(
      (select session_id from phase6_session_a)
    )
  $$,
  'P0001',
  'PACKING_SESSION_OPERATOR_MISMATCH',
  'another operator cannot finalize the session'
);

select set_config(
  'request.jwt.claim.sub',
  'a6100000-0000-0000-0000-000000000001',
  true
);

reset role;
set local role anon;

select throws_ok(
  $$
    select public.finalize_packing_session(
      (select session_id from phase6_session_a)
    )
  $$,
  '42501',
  'permission denied for function finalize_packing_session',
  'anon has no execute privilege for finalize'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a6100000-0000-0000-0000-000000000001',
  true
);

-- Happy path: first finalize call allocates the sequence and label reference.
create temporary table phase6_finalize_a1 as
select *
from public.finalize_packing_session(
  (select session_id from phase6_session_a)
);
grant select on phase6_finalize_a1 to public;

select is(
  (select already_finalized from phase6_finalize_a1),
  false,
  'first finalize call is not a replay'
);

select is(
  (select label_reference from phase6_finalize_a1),
  (select sequence_no::text || '-150526-B101-T6' from phase6_finalize_a1),
  'label_reference matches {sequence_no}-{DDMMYY}-{box_code} with no zero-padding'
);

select is(
  (select qty from phase6_finalize_a1),
  40,
  'qty snapshot comes from master_items.default_label_qty (BR-08), not a hardcoded constant'
);

select is(
  (select session_status::text from phase6_finalize_a1),
  'print_pending',
  'finalize transitions the session to print_pending'
);

select is(
  (
    select supplier_code || ':' || supplier_name || ':' || part_no || ':' || part_name
      || ':' || delivery_number || ':' || delivery_date::text || ':' || box_code || ':' || box_name
    from phase6_finalize_a1
  ),
  'PH6SUP:Phase 6 Supplier:PHASE6-PART:Phase 6 Part:DN-PHASE6-ACTIVE:2026-05-15:B101-T6:Phase 6 B101',
  'finalize snapshots supplier, part, DN, and box fields onto the print job'
);

select is(
  (select qty_delivery::text || ':' || lot_no from phase6_finalize_a1),
  '25:LOT-P6-A',
  'finalize snapshots the manual qty delivery and lot no'
);

select isnt(
  (select qr_generated_at from phase6_finalize_a1),
  null,
  'finalize stamps the QR generation timestamp'
);

-- Idempotent replay: a second finalize call (retry, or the loser of a
-- concurrent race after waiting on the row lock) returns the same job.
create temporary table phase6_finalize_a2 as
select *
from public.finalize_packing_session(
  (select session_id from phase6_session_a)
);
grant select on phase6_finalize_a2 to public;

select is(
  (select already_finalized from phase6_finalize_a2),
  true,
  'second finalize call on the same session replays as already_finalized'
);

select is(
  (select sequence_no from phase6_finalize_a2),
  (select sequence_no from phase6_finalize_a1),
  'replay does not allocate a new sequence value'
);

select is(
  (select label_reference from phase6_finalize_a2),
  (select label_reference from phase6_finalize_a1),
  'replay returns the same label_reference'
);

select is(
  (select print_job_id from phase6_finalize_a2),
  (select print_job_id from phase6_finalize_a1),
  'replay returns the same print_job_id'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.print_jobs job
    join phase6_session_a started on started.session_id = job.packing_session_id
    where job.parent_print_job_id is null
  ),
  1,
  'two finalize calls on the same session produce exactly one print job row'
);

select is(
  (
    select count(*)::integer
    from public.audit_logs audit
    join phase6_session_a started on started.session_id::text = audit.entity_id
    where audit.action = 'packing_session.finalized'
  ),
  1,
  'finalize is audited exactly once, not once per replay'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a6100000-0000-0000-0000-000000000001',
  true
);

-- Session B: driven to ready_to_finalize, used to exercise Delivery Number
-- validation without disturbing session A's already-finalized state.
create temporary table phase6_session_b as
select *
from public.start_packing_session(
  'a6200000-0000-0000-0000-000000000001',
  'a6400000-0000-0000-0000-000000000001',
  'a6700000-0000-0000-0000-000000000001',
  date '2026-06-20',
  30,
  'LOT-P6-B'
);
grant select on phase6_session_b to public;

select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase6_session_b),
      'phase6-b-uid-1', 'phase6-b-hash-1', '5.5 x 6.3 x 205', '5.5x6.3x205'
    )
  $$,
  'session B scan 1 accepted'
);
select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase6_session_b),
      'phase6-b-uid-2', 'phase6-b-hash-2', '5.5 x 6.3 x 205', '5.5x6.3x205'
    )
  $$,
  'session B scan 2 accepted'
);
select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase6_session_b),
      'phase6-b-uid-3', 'phase6-b-hash-3', '5.5 x 6.3 x 205', '5.5x6.3x205'
    )
  $$,
  'session B scan 3 accepted'
);
select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase6_session_b),
      'phase6-b-uid-4', 'phase6-b-hash-4', '5.5 x 6.3 x 205', '5.5x6.3x205'
    )
  $$,
  'session B scan 4 accepted'
);
select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase6_session_b),
      'phase6-b-uid-5', 'phase6-b-hash-5', '5.5 x 6.3 x 205', '5.5x6.3x205'
    )
  $$,
  'session B scan 5 accepted'
);
select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase6_session_b),
      'phase6-b-uid-6', 'phase6-b-hash-6', '5.5 x 6.3 x 205', '5.5x6.3x205'
    )
  $$,
  'session B scan 6 accepted'
);
select lives_ok(
  $$
    select public.accept_packing_scan(
      (select session_id from phase6_session_b),
      'phase6-b-uid-7', 'phase6-b-hash-7', '5.5 x 6.3 x 205', '5.5x6.3x205'
    )
  $$,
  'session B scan 7 accepted'
);

select is(
  (
    select session_status::text
    from public.accept_packing_scan(
      (select session_id from phase6_session_b),
      'phase6-b-uid-8', 'phase6-b-hash-8', '5.5 x 6.3 x 205', '5.5x6.3x205'
    )
  ),
  'ready_to_finalize',
  'eighth session B scan transitions to ready_to_finalize'
);

-- The DN was valid when session B started. An admin closing it mid-session
-- must block finalize rather than let a box print against a closed DN.
reset role;

update public.delivery_numbers
set status = 'closed'
where id = 'a6800000-0000-0000-0000-000000000005';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a6100000-0000-0000-0000-000000000001',
  true
);

select throws_ok(
  $$
    select public.finalize_packing_session(
      (select session_id from phase6_session_b)
    )
  $$,
  'P0001',
  'DELIVERY_NUMBER_INVALID',
  'a Delivery Number closed mid-session blocks finalize'
);

select is(
  (select status::text from public.packing_sessions where id = (select session_id from phase6_session_b)),
  'ready_to_finalize',
  'session B is untouched after every rejected finalize attempt'
);

reset role;

select is(
  (
    select count(*)::integer
    from public.print_jobs job
    join phase6_session_b started on started.session_id = job.packing_session_id
  ),
  0,
  'no print job is created when Delivery Number validation fails'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'a6100000-0000-0000-0000-000000000001',
  true
);

-- Session C: still scanning, never reaches ready_to_finalize.
create temporary table phase6_session_c as
select *
from public.start_packing_session(
  'a6200000-0000-0000-0000-000000000001',
  'a6400000-0000-0000-0000-000000000001',
  'a6700000-0000-0000-0000-000000000001',
  date '2026-05-15',
  15,
  'LOT-P6-C'
);

select throws_ok(
  $$
    select public.finalize_packing_session(
      (select session_id from phase6_session_c)
    )
  $$,
  'P0001',
  'SESSION_NOT_COMPLETE',
  'a session that has not reached ready_to_finalize is rejected'
);

reset role;

select * from finish();

rollback;
