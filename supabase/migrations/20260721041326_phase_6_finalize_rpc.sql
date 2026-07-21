-- Phase 6 finalizes a completed packing session into exactly one print job.
-- The sequence is global and never reset (BR-04); the label reference format
-- is {sequence_no}-{delivery_date_DDMMYY}-{box_code}, unpadded (BR-03/BR-06).
-- Finalize is idempotent: replaying against an already-finalized session (or
-- losing the row-lock race to a concurrent finalize call) returns the same
-- print job snapshot instead of raising an error (see
-- docs/superpowers/specs/2026-07-21-phase-6-finalize-design.md).

create sequence if not exists public.print_job_sequence as bigint minvalue 1;

-- Defense in depth: schema-level `alter default privileges` already revokes
-- all on new sequences from anon/authenticated, but state it explicitly so
-- the intent is visible in this migration and cannot regress silently.
revoke all on sequence public.print_job_sequence from public, anon, authenticated;

create or replace function public.finalize_packing_session(
  p_packing_session_id uuid,
  p_delivery_number_id uuid
)
returns table (
  print_job_id uuid,
  packing_session_id uuid,
  session_status public.packing_session_status,
  sequence_no bigint,
  label_reference text,
  supplier_code text,
  supplier_name text,
  part_no text,
  part_name text,
  qty integer,
  delivery_number text,
  delivery_date date,
  box_code text,
  box_name text,
  already_finalized boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_session public.packing_sessions%rowtype;
  target_item public.master_items%rowtype;
  target_box public.box_definitions%rowtype;
  target_dn public.delivery_numbers%rowtype;
  target_supplier public.suppliers%rowtype;
  existing_job public.print_jobs%rowtype;
  new_job public.print_jobs%rowtype;
  expected_total integer;
  accepted_total integer;
  new_sequence_no bigint;
  new_label_reference text;
  resulting_status public.packing_session_status;
  finalize_correlation_id uuid := gen_random_uuid();
begin
  select * into target_session
  from public.packing_sessions session
  where session.id = p_packing_session_id
  for update;

  if target_session.id is null then
    raise exception using errcode = 'P0001', message = 'PACKING_SESSION_NOT_FOUND';
  end if;

  if target_session.operator_id <> auth.uid() then
    raise exception using errcode = 'P0001', message = 'PACKING_SESSION_OPERATOR_MISMATCH';
  end if;

  perform private.assert_active_assigned_workstation(target_session.workstation_id);

  -- Idempotent replay: a genuine retry of the same request, or a concurrent
  -- second finalize call that lost the row-lock race above, both observe the
  -- session already past ready_to_finalize and return the existing job
  -- rather than allocating a new sequence value or raising an error.
  if target_session.status in ('print_pending', 'printing', 'sent_to_printer', 'confirmed') then
    select * into existing_job
    from public.print_jobs job
    where job.packing_session_id = target_session.id
      and job.parent_print_job_id is null;

    if existing_job.id is null then
      raise exception using errcode = 'P0001', message = 'SESSION_NOT_COMPLETE';
    end if;

    return query
    select
      existing_job.id,
      target_session.id,
      target_session.status,
      existing_job.sequence_no,
      existing_job.label_reference,
      existing_job.supplier_code_snapshot,
      existing_job.supplier_name_snapshot,
      existing_job.part_no_snapshot,
      existing_job.part_name_snapshot,
      existing_job.qty_snapshot,
      existing_job.delivery_number_snapshot,
      existing_job.delivery_date_snapshot,
      existing_job.box_code_snapshot,
      existing_job.box_name_snapshot,
      true;
    return;
  end if;

  if target_session.status <> 'ready_to_finalize' then
    raise exception using errcode = 'P0001', message = 'SESSION_NOT_COMPLETE';
  end if;

  select * into target_item
  from public.master_items item
  where item.id = target_session.master_item_id;

  select * into target_box
  from public.box_definitions box
  where box.id = target_session.box_definition_id;

  -- Race guard: recalculate accepted vs expected quantity per layer using
  -- the same aggregation pattern as accept_packing_scan, in case layer
  -- requirements changed between ready_to_finalize and this finalize call.
  select coalesce(sum(requirement.expected_qty), 0)::integer into expected_total
  from public.box_layers layer
  join public.box_layer_requirements requirement
    on requirement.box_layer_id = layer.id
  where layer.box_definition_id = target_session.box_definition_id
    and layer.is_active;

  select count(*)::integer into accepted_total
  from public.packing_session_scans scan
  where scan.packing_session_id = target_session.id
    and scan.result = 'accepted';

  if expected_total <= 0 or accepted_total <> expected_total then
    raise exception using errcode = 'P0001', message = 'SESSION_NOT_COMPLETE';
  end if;

  select * into target_dn
  from public.delivery_numbers dn
  where dn.id = p_delivery_number_id
    and dn.status = 'active';

  if target_dn.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  select * into target_supplier
  from public.suppliers supplier
  where supplier.id = target_dn.supplier_id;

  if target_supplier.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  select nextval('public.print_job_sequence') into new_sequence_no;

  new_label_reference := new_sequence_no::text || '-'
    || to_char(target_dn.delivery_date, 'DDMMYY') || '-' || target_box.box_code;

  insert into public.print_jobs (
    packing_session_id,
    workstation_id,
    status,
    supplier_code_snapshot,
    supplier_name_snapshot,
    part_no_snapshot,
    part_name_snapshot,
    qty_snapshot,
    delivery_number_snapshot,
    delivery_date_snapshot,
    box_code_snapshot,
    box_name_snapshot,
    sequence_no,
    label_reference,
    template_version,
    zpl_payload,
    created_by
  ) values (
    target_session.id,
    target_session.workstation_id,
    'pending',
    target_supplier.supplier_code,
    target_supplier.supplier_name,
    target_item.part_no,
    target_item.part_name,
    target_item.default_label_qty,
    target_dn.delivery_number,
    target_dn.delivery_date,
    target_box.box_code,
    target_box.box_name,
    new_sequence_no,
    new_label_reference,
    'v1',
    'PENDING_ZPL_GENERATION',
    auth.uid()
  )
  returning * into new_job;

  update public.packing_sessions session
  set status = 'print_pending',
    delivery_number_id = p_delivery_number_id,
    finalized_at = statement_timestamp()
  where session.id = target_session.id
  returning session.status into resulting_status;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    workstation_id,
    metadata,
    correlation_id
  ) values (
    auth.uid(),
    'packing_session.finalized',
    'packing_session',
    target_session.id::text,
    target_session.workstation_id,
    jsonb_build_object(
      'print_job_id', new_job.id,
      'sequence_no', new_sequence_no,
      'label_reference', new_label_reference,
      'delivery_number_id', p_delivery_number_id,
      'master_item_id', target_session.master_item_id,
      'box_definition_id', target_session.box_definition_id,
      'qty_snapshot', target_item.default_label_qty
    ),
    finalize_correlation_id
  );

  return query
  select
    new_job.id,
    target_session.id,
    resulting_status,
    new_sequence_no,
    new_label_reference,
    target_supplier.supplier_code,
    target_supplier.supplier_name,
    target_item.part_no,
    target_item.part_name,
    target_item.default_label_qty,
    target_dn.delivery_number,
    target_dn.delivery_date,
    target_box.box_code,
    target_box.box_name,
    false;
end;
$$;

revoke execute on function public.finalize_packing_session(uuid, uuid)
  from public, anon;

grant execute on function public.finalize_packing_session(uuid, uuid)
  to authenticated;
