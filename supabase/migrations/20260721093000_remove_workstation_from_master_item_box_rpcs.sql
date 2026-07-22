-- Corrective migration: 20260721090000_restructure_box_master_data.sql and
-- 20260721091000_repoint_scan_finalize_to_master_item_box.sql were authored
-- concurrently against a pre-workstation-removal snapshot of the phase 5/6
-- RPCs (i.e. before 20260721081938_remove_workstation.sql landed on this
-- same hosted project). 091000 therefore reintroduced p_workstation_id,
-- private.assert_active_assigned_workstation(), and workstation_id column
-- references into start_packing_session/accept_packing_scan/
-- finalize_packing_session -- but it did not recreate the workstations
-- table, the workstation_id columns, or the assertion helper (those stay
-- dropped). The three RPCs from 091000 are therefore broken at call time:
-- they reference objects that no longer exist.
--
-- This migration reapplies the workstation-removal contract
-- (docs/superpowers/specs/2026-07-21-remove-workstation-design.md) on top
-- of the new boxes/master_item_boxes/box_layer_requirements shape from
-- 090000: same masters-item-box-based join logic as 091000, minus every
-- workstation_id parameter/column/assertion call.

drop function if exists public.start_packing_session(uuid, uuid, uuid);
-- 20260721081938_remove_workstation.sql already replaced this with a 2-arg
-- (master_item_id, box_definition_id) overload returning a box_definition_id
-- column; same arg types as the version below but a different OUT-parameter
-- name, which `create or replace` cannot reconcile. Drop it explicitly first.
drop function if exists public.start_packing_session(uuid, uuid);

create or replace function public.start_packing_session(
  p_master_item_id uuid,
  p_master_item_box_id uuid
)
returns table (
  session_id uuid,
  status public.packing_session_status,
  operator_id uuid,
  master_item_id uuid,
  master_item_box_id uuid,
  total_expected_qty integer,
  accepted_qty integer,
  started_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  active_assignment public.master_item_boxes%rowtype;
  created_session public.packing_sessions%rowtype;
  expected_total integer;
begin
  if not private.is_active_operator() then
    raise exception using errcode = 'P0001', message = 'PACKING_SESSION_OPERATOR_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.master_items item
    where item.id = p_master_item_id and item.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_ACTIVE';
  end if;

  select * into active_assignment
  from public.master_item_boxes assignment
  where assignment.id = p_master_item_box_id
    and assignment.master_item_id = p_master_item_id
    and assignment.is_active;

  if active_assignment.id is null then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_NOT_ACTIVE_OR_MISMATCH';
  end if;

  select coalesce(sum(requirement.expected_qty), 0)::integer into expected_total
  from public.box_layer_requirements requirement
  join public.box_layers layer on layer.id = requirement.box_layer_id
  where requirement.master_item_box_id = active_assignment.id
    and layer.is_active;

  if expected_total <= 0 then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_EMPTY';
  end if;

  insert into public.packing_sessions (
    operator_id,
    master_item_id,
    master_item_box_id,
    status,
    version
  ) values (
    auth.uid(),
    p_master_item_id,
    active_assignment.id,
    'scanning',
    active_assignment.version
  )
  returning * into created_session;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    auth.uid(),
    'packing_session.started',
    'packing_session',
    created_session.id::text,
    jsonb_build_object(
      'master_item_id', created_session.master_item_id,
      'master_item_box_id', created_session.master_item_box_id,
      'master_item_box_version', active_assignment.version,
      'total_expected_qty', expected_total
    )
  );

  return query
  select
    created_session.id,
    created_session.status,
    created_session.operator_id,
    created_session.master_item_id,
    created_session.master_item_box_id,
    expected_total,
    0,
    created_session.started_at;
end;
$$;

create or replace function public.accept_packing_scan(
  p_packing_session_id uuid,
  p_label_uid text,
  p_raw_payload_hash text,
  p_scanned_size text,
  p_normalized_size text
)
returns table (
  result public.scan_result,
  error_code text,
  session_id uuid,
  session_status public.packing_session_status,
  product_id uuid,
  box_layer_id uuid,
  layer_accepted_qty integer,
  layer_expected_qty integer,
  total_accepted_qty integer,
  total_expected_qty integer,
  ready_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_session public.packing_sessions%rowtype;
  target_item public.master_items%rowtype;
  target_product public.products%rowtype;
  normalized_label_uid text := nullif(btrim(p_label_uid), '');
  normalized_size text := lower(btrim(p_normalized_size));
  raw_hash text := btrim(p_raw_payload_hash);
  scan_result_value public.scan_result;
  scan_error_code text;
  selected_box_layer_id uuid;
  selected_layer_expected_qty integer;
  selected_layer_accepted_qty integer := 0;
  selected_product_id uuid;
  expected_total integer;
  accepted_total integer;
  resulting_status public.packing_session_status;
  resulting_ready_at timestamptz;
  scan_correlation_id uuid := gen_random_uuid();
begin
  if raw_hash is null
    or raw_hash = ''
    or p_scanned_size is null
    or btrim(p_scanned_size) = ''
    or normalized_size is null
    or normalized_size = '' then
    raise exception using errcode = 'P0001', message = 'SCAN_INPUT_INVALID';
  end if;

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

  if target_session.status <> 'scanning' then
    raise exception using errcode = 'P0001', message = 'SESSION_NOT_ACCEPTING_SCAN';
  end if;

  select * into target_item
  from public.master_items item
  where item.id = target_session.master_item_id and item.is_active;

  if target_item.id is null then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_ACTIVE';
  end if;

  select coalesce(sum(requirement.expected_qty), 0)::integer into expected_total
  from public.box_layer_requirements requirement
  join public.box_layers layer on layer.id = requirement.box_layer_id
  where requirement.master_item_box_id = target_session.master_item_box_id
    and layer.is_active;

  if expected_total <= 0 then
    raise exception using errcode = 'P0001', message = 'SESSION_BOX_DEFINITION_INVALID';
  end if;

  select count(*)::integer into accepted_total
  from public.packing_session_scans scan
  where scan.packing_session_id = target_session.id
    and scan.result = 'accepted';

  if normalized_label_uid is null
    or normalized_label_uid ~ '[[:cntrl:]]'
    or char_length(normalized_label_uid) > 256 then
    scan_result_value := 'invalid';
    scan_error_code := case
      when normalized_label_uid is null then 'LABEL_UID_MISSING'
      else 'LABEL_UID_INVALID'
    end;
  elsif exists (
    select 1
    from public.packing_session_scans scan
    where scan.label_uid = normalized_label_uid
      and scan.result = 'accepted'
  ) then
    scan_result_value := 'duplicate';
    scan_error_code := 'LABEL_ALREADY_SCANNED';
  else
    select product.* into target_product
    from public.products product
    join public.master_item_products mapping
      on mapping.product_id = product.id
      and mapping.master_item_id = target_session.master_item_id
      and mapping.is_active
    where product.normalized_dimensions = normalized_size
      and product.is_active
    order by product.id
    limit 1;

    if target_product.id is null then
      select product.* into target_product
      from public.products product
      where product.normalized_dimensions = normalized_size
        and product.is_active
      order by product.id
      limit 1;

      if target_product.id is null then
        scan_result_value := 'invalid';
        scan_error_code := 'PRODUCT_SIZE_NOT_FOUND';
      else
        selected_product_id := target_product.id;
        scan_result_value := 'invalid';
        scan_error_code := 'PRODUCT_NOT_ALLOWED_FOR_PART';
      end if;
    else
      selected_product_id := target_product.id;

      select
        requirement.box_layer_id,
        requirement.expected_qty,
        count(scan.id)::integer
      into
        selected_box_layer_id,
        selected_layer_expected_qty,
        selected_layer_accepted_qty
      from public.box_layer_requirements requirement
      join public.box_layers layer
        on layer.id = requirement.box_layer_id
      left join public.packing_session_scans scan
        on scan.packing_session_id = target_session.id
        and scan.box_layer_id = requirement.box_layer_id
        and scan.result = 'accepted'
      where requirement.master_item_box_id = target_session.master_item_box_id
        and layer.is_active
        and requirement.product_id = target_product.id
      group by requirement.box_layer_id, requirement.expected_qty,
        layer.sort_order, requirement.sort_order
      having count(scan.id) < requirement.expected_qty
      order by layer.sort_order, requirement.sort_order
      limit 1;

      if selected_box_layer_id is not null then
        scan_result_value := 'accepted';
        scan_error_code := null;
      elsif exists (
        select 1
        from public.box_layer_requirements requirement
        join public.box_layers layer
          on layer.id = requirement.box_layer_id
        where requirement.master_item_box_id = target_session.master_item_box_id
          and layer.is_active
          and requirement.product_id = target_product.id
      ) then
        scan_result_value := 'over_qty';
        scan_error_code := 'LAYER_QUANTITY_FULL';
      else
        scan_result_value := 'invalid';
        scan_error_code := 'PRODUCT_NOT_REQUIRED_IN_BOX';
      end if;
    end if;
  end if;

  if scan_result_value = 'accepted' then
    begin
      insert into public.packing_session_scans (
        packing_session_id,
        label_uid,
        raw_payload_hash,
        scanned_part_no,
        scanned_size,
        normalized_size,
        product_id,
        box_layer_id,
        result,
        scanned_by,
        correlation_id
      ) values (
        target_session.id,
        normalized_label_uid,
        raw_hash,
        target_item.part_no,
        btrim(p_scanned_size),
        normalized_size,
        selected_product_id,
        selected_box_layer_id,
        'accepted',
        auth.uid(),
        scan_correlation_id
      );
    exception when unique_violation then
      scan_result_value := 'duplicate';
      scan_error_code := 'LABEL_ALREADY_SCANNED';
      selected_box_layer_id := null;
      selected_layer_expected_qty := null;
      selected_layer_accepted_qty := 0;
    end;
  end if;

  if scan_result_value <> 'accepted' then
    insert into public.packing_session_scans (
      packing_session_id,
      label_uid,
      raw_payload_hash,
      scanned_part_no,
      scanned_size,
      normalized_size,
      product_id,
      box_layer_id,
      result,
      error_code,
      scanned_by,
      correlation_id
    ) values (
      target_session.id,
      normalized_label_uid,
      raw_hash,
      target_item.part_no,
      btrim(p_scanned_size),
      normalized_size,
      selected_product_id,
      null,
      scan_result_value,
      scan_error_code,
      auth.uid(),
      scan_correlation_id
    );
  end if;

  if scan_result_value = 'accepted' then
    selected_layer_accepted_qty := selected_layer_accepted_qty + 1;

    select count(*)::integer into accepted_total
    from public.packing_session_scans scan
    where scan.packing_session_id = target_session.id
      and scan.result = 'accepted';

    if accepted_total = expected_total then
      update public.packing_sessions session
      set status = 'ready_to_finalize', ready_at = statement_timestamp()
      where session.id = target_session.id
        and session.status = 'scanning'
      returning session.status, session.ready_at
      into resulting_status, resulting_ready_at;
    else
      resulting_status := target_session.status;
      resulting_ready_at := target_session.ready_at;
    end if;
  else
    resulting_status := target_session.status;
    resulting_ready_at := target_session.ready_at;
  end if;

  insert into public.audit_logs (
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata,
    correlation_id
  ) values (
    auth.uid(),
    case when scan_result_value = 'accepted' then 'packing_scan.accepted' else 'packing_scan.rejected' end,
    'packing_session_scan',
    target_session.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'result', scan_result_value::text,
      'error_code', scan_error_code,
      'product_id', selected_product_id,
      'box_layer_id', selected_box_layer_id,
      'raw_payload_hash', raw_hash,
      'total_accepted_qty', accepted_total,
      'total_expected_qty', expected_total
    )),
    scan_correlation_id
  );

  return query
  select
    scan_result_value,
    scan_error_code,
    target_session.id,
    resulting_status,
    selected_product_id,
    selected_box_layer_id,
    selected_layer_accepted_qty,
    selected_layer_expected_qty,
    accepted_total,
    expected_total,
    resulting_ready_at;
end;
$$;

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
  target_box public.boxes%rowtype;
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

  select box.* into target_box
  from public.boxes box
  join public.master_item_boxes assignment on assignment.box_id = box.id
  where assignment.id = target_session.master_item_box_id;

  select coalesce(sum(requirement.expected_qty), 0)::integer into expected_total
  from public.box_layer_requirements requirement
  join public.box_layers layer on layer.id = requirement.box_layer_id
  where requirement.master_item_box_id = target_session.master_item_box_id
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
    metadata,
    correlation_id
  ) values (
    auth.uid(),
    'packing_session.finalized',
    'packing_session',
    target_session.id::text,
    jsonb_build_object(
      'print_job_id', new_job.id,
      'sequence_no', new_sequence_no,
      'label_reference', new_label_reference,
      'delivery_number_id', p_delivery_number_id,
      'master_item_id', target_session.master_item_id,
      'master_item_box_id', target_session.master_item_box_id,
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

revoke execute on function public.start_packing_session(uuid, uuid) from public, anon;
revoke execute on function public.accept_packing_scan(uuid, text, text, text, text) from public, anon;
revoke execute on function public.finalize_packing_session(uuid, uuid) from public, anon;

grant execute on function public.start_packing_session(uuid, uuid) to authenticated;
grant execute on function public.accept_packing_scan(uuid, text, text, text, text) to authenticated;
grant execute on function public.finalize_packing_session(uuid, uuid) to authenticated;
