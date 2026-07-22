-- Phase 7 print RPCs: claim/complete authorization, state machine, attempt
-- audit, retry, and stale re-claim. Spec:
-- docs/superpowers/specs/2026-07-22-phase-7-qz-print-design.md

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(26);

select ok(
  not has_function_privilege(
    'anon', 'public.claim_print_job(uuid, text)', 'EXECUTE'
  ),
  'anon has no execute privilege on claim_print_job'
);
select ok(
  not has_function_privilege(
    'anon', 'public.complete_print_job(uuid, public.print_attempt_result, text, text, text)', 'EXECUTE'
  ),
  'anon has no execute privilege on complete_print_job'
);

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('a7100000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'phase7-operator@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('a7100000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'phase7-other@example.test', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, display_name, role, is_active) values
  ('a7100000-0000-0000-0000-000000000001', 'Phase 7 Operator', 'operator', true),
  ('a7100000-0000-0000-0000-000000000002', 'Phase 7 Other', 'operator', true);

insert into public.master_items (id, item_code, part_no, part_name, unit, default_label_qty, is_active)
values ('a7200000-0000-0000-0000-000000000001', 'phase7-item', 'PHASE7-PART', 'Phase 7 Part', 'Pcs', 100, true);

insert into public.boxes (id, box_code, box_name, is_active)
values ('a7400000-0000-0000-0000-000000000001', 'B701', 'Phase 7 Box', true);

insert into public.master_item_boxes (id, master_item_id, box_id, version, is_active)
values ('a7450000-0000-0000-0000-000000000001', 'a7200000-0000-0000-0000-000000000001', 'a7400000-0000-0000-0000-000000000001', 1, true);

insert into public.packing_sessions (id, operator_id, master_item_id, master_item_box_id, status)
values ('a7600000-0000-0000-0000-000000000001', 'a7100000-0000-0000-0000-000000000001',
        'a7200000-0000-0000-0000-000000000001', 'a7450000-0000-0000-0000-000000000001', 'print_pending');

insert into public.print_jobs (
  id, packing_session_id, status, supplier_code_snapshot, supplier_name_snapshot,
  part_no_snapshot, part_name_snapshot, qty_snapshot, delivery_number_snapshot,
  delivery_date_snapshot, box_code_snapshot, box_name_snapshot, sequence_no,
  label_reference, template_version, zpl_payload, created_by
) values (
  'a7700000-0000-0000-0000-000000000001', 'a7600000-0000-0000-0000-000000000001', 'pending',
  '10015', 'Phase 7 Supplier', 'PHASE7-PART', 'Phase 7 Part', 100, 'DN-P7-001',
  date '2026-05-15', 'B701', 'Phase 7 Box', 9001, '9001-150526-B701', 'v1',
  'PENDING_ZPL_GENERATION', 'a7100000-0000-0000-0000-000000000001'
);

-- Wrong operator cannot claim.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7100000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$ select public.claim_print_job('a7700000-0000-0000-0000-000000000001', '^XA^FDx^FS^XZ') $$,
  'P0001', 'PRINT_JOB_FORBIDDEN', 'non-owner operator cannot claim'
);

-- Owner claims successfully.
select set_config('request.jwt.claim.sub', 'a7100000-0000-0000-0000-000000000001', true);

select throws_ok(
  $$ select public.claim_print_job('a7700000-0000-0000-0000-000000000001', 'NOPE') $$,
  'P0001', 'PRINT_PAYLOAD_INVALID', 'payload must be ^XA..^XZ'
);
select throws_ok(
  $$ select public.claim_print_job('a7700000-0000-0000-0000-000000000001', '^XA' || repeat('X', 17000) || '^XZ') $$,
  'P0001', 'PRINT_PAYLOAD_INVALID', 'payload over 16KB rejected'
);
select throws_ok(
  $$ select public.claim_print_job('00000000-0000-0000-0000-00000000dead', '^XA^FDx^FS^XZ') $$,
  'P0001', 'PRINT_JOB_NOT_FOUND', 'unknown job id rejected'
);

create temporary table phase7_claim as
select * from public.claim_print_job('a7700000-0000-0000-0000-000000000001', '^XA^FDreal^FS^XZ');

select is((select job_status from phase7_claim), 'printing'::public.print_job_status, 'claim sets job printing');
select is((select session_status from phase7_claim), 'printing'::public.packing_session_status, 'claim sets session printing');

-- Non-owner cannot complete a printing job.
select set_config('request.jwt.claim.sub', 'a7100000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$ select public.complete_print_job('a7700000-0000-0000-0000-000000000001', 'sent', 'ZDesigner ZD220-203dpi ZPL') $$,
  'P0001', 'PRINT_JOB_FORBIDDEN', 'non-owner operator cannot complete'
);
select set_config('request.jwt.claim.sub', 'a7100000-0000-0000-0000-000000000001', true);

reset role;
select is(
  (select zpl_payload from public.print_jobs where id = 'a7700000-0000-0000-0000-000000000001'),
  '^XA^FDreal^FS^XZ', 'claim persists zpl payload'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7100000-0000-0000-0000-000000000001', true);

-- Fresh double-claim blocked (job now printing, updated_at recent).
select throws_ok(
  $$ select public.claim_print_job('a7700000-0000-0000-0000-000000000001', '^XA^FDagain^FS^XZ') $$,
  'P0001', 'PRINT_JOB_NOT_CLAIMABLE', 'recent printing job cannot be re-claimed'
);

-- Complete failed path.
select throws_ok(
  $$ select public.complete_print_job('a7700000-0000-0000-0000-000000000001', 'sent', '') $$,
  'P0001', 'PRINTER_NAME_REQUIRED', 'printer name required'
);

create temporary table phase7_fail as
select * from public.complete_print_job(
  'a7700000-0000-0000-0000-000000000001', 'failed',
  'ZDesigner ZD220-203dpi ZPL', 'QZ_SEND_FAILED', 'Gagal mengirim ke printer.'
);

select is((select job_status from phase7_fail), 'failed'::public.print_job_status, 'failed result sets job failed');
select is((select session_status from phase7_fail), 'print_failed'::public.packing_session_status, 'failed result sets session print_failed');
select is((select attempt_no from phase7_fail), 1, 'first attempt recorded as attempt 1');

reset role;
select is(
  (select count(*)::integer from public.print_attempts where print_job_id = 'a7700000-0000-0000-0000-000000000001'),
  1, 'one attempt row inserted'
);
select is(
  (select error_code from public.print_attempts where print_job_id = 'a7700000-0000-0000-0000-000000000001' and attempt_no = 1),
  'QZ_SEND_FAILED', 'attempt stores error code'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a7100000-0000-0000-0000-000000000001', true);

-- Retry: re-claim from failed, then complete sent.
create temporary table phase7_reclaim as
select * from public.claim_print_job('a7700000-0000-0000-0000-000000000001', '^XA^FDretry^FS^XZ');
select is((select job_status from phase7_reclaim), 'printing'::public.print_job_status, 'failed job re-claimable');
select is((select session_status from phase7_reclaim), 'printing'::public.packing_session_status, 'failed session returns to printing on re-claim');

select throws_ok(
  $$ select public.complete_print_job('00000000-0000-0000-0000-00000000dead', 'sent', 'p') $$,
  'P0001', 'PRINT_JOB_NOT_FOUND', 'complete unknown job rejected'
);

create temporary table phase7_sent as
select * from public.complete_print_job('a7700000-0000-0000-0000-000000000001', 'sent', 'ZDesigner ZD220-203dpi ZPL');

select is((select job_status from phase7_sent), 'confirmed'::public.print_job_status, 'sent result sets job confirmed');
select is((select session_status from phase7_sent), 'confirmed'::public.packing_session_status, 'sent result sets session confirmed');
select is((select attempt_no from phase7_sent), 2, 'retry increments attempt number');

-- Completed job no longer completable.
select throws_ok(
  $$ select public.complete_print_job('a7700000-0000-0000-0000-000000000001', 'sent', 'p') $$,
  'P0001', 'PRINT_JOB_NOT_PRINTING', 'confirmed job cannot be completed again'
);

reset role;
select is(
  (select confirmed_at is not null and sent_at is not null from public.print_jobs where id = 'a7700000-0000-0000-0000-000000000001'),
  true, 'sent/confirmed timestamps set'
);
select is(
  (select count(*)::integer from public.audit_logs
   where entity_type = 'print_job' and entity_id = 'a7700000-0000-0000-0000-000000000001'),
  4, 'audit rows for two claims and two attempts'
);

select * from finish();

rollback;
