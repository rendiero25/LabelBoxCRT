-- Phase 7: print job claim/complete RPCs (spec
-- docs/superpowers/specs/2026-07-22-phase-7-qz-print-design.md).
-- All print_jobs/print_attempts mutation stays RPC-only; no INSERT/UPDATE
-- RLS policies are added.

create or replace function public.claim_print_job(
  p_print_job_id uuid,
  p_zpl_payload text
)
returns table (
  print_job_id uuid,
  packing_session_id uuid,
  job_status public.print_job_status,
  session_status public.packing_session_status,
  attempt_count integer,
  label_reference text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_job public.print_jobs%rowtype;
  target_session public.packing_sessions%rowtype;
  resulting_session_status public.packing_session_status;
begin
  if not (select private.is_active_operator()) and not (select private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_FORBIDDEN';
  end if;

  if p_zpl_payload is null
     or length(p_zpl_payload) = 0
     or length(p_zpl_payload) > 16384
     or p_zpl_payload not like '^XA%'
     or p_zpl_payload not like '%^XZ' then
    raise exception using errcode = 'P0001', message = 'PRINT_PAYLOAD_INVALID';
  end if;

  select * into target_job
  from public.print_jobs job
  where job.id = p_print_job_id
  for update;

  if target_job.id is null then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_NOT_FOUND';
  end if;

  select * into target_session
  from public.packing_sessions session
  where session.id = target_job.packing_session_id
  for update;

  if target_session.operator_id <> auth.uid() and not (select private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_FORBIDDEN';
  end if;

  -- Claimable: fresh (pending), retry (failed), or stale self re-claim
  -- (printing older than 2 minutes — tab died mid-print).
  if not (
    target_job.status in ('pending', 'failed')
    or (
      target_job.status = 'printing'
      and target_job.updated_at < statement_timestamp() - interval '2 minutes'
    )
  ) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_NOT_CLAIMABLE';
  end if;

  update public.print_jobs job
  set status = 'printing', zpl_payload = p_zpl_payload
  where job.id = target_job.id
  returning * into target_job;

  update public.packing_sessions session
  set status = 'printing'
  where session.id = target_session.id
    and session.status in ('print_pending', 'print_failed', 'printing')
  returning session.status into resulting_session_status;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'print_job.claimed', 'print_job', target_job.id::text,
    jsonb_build_object(
      'packing_session_id', target_session.id,
      'attempt_count', target_job.attempt_count,
      'zpl_length', length(p_zpl_payload)
    )
  );

  return query select
    target_job.id, target_session.id, target_job.status,
    coalesce(resulting_session_status, target_session.status),
    target_job.attempt_count, target_job.label_reference;
end;
$$;

create or replace function public.complete_print_job(
  p_print_job_id uuid,
  p_result public.print_attempt_result,
  p_printer_name text,
  p_error_code text default null,
  p_error_message_safe text default null
)
returns table (
  print_job_id uuid,
  packing_session_id uuid,
  job_status public.print_job_status,
  session_status public.packing_session_status,
  attempt_no integer,
  label_reference text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_job public.print_jobs%rowtype;
  target_session public.packing_sessions%rowtype;
  new_attempt_no integer;
  resulting_session_status public.packing_session_status;
begin
  if not (select private.is_active_operator()) and not (select private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_FORBIDDEN';
  end if;

  if p_printer_name is null or length(trim(p_printer_name)) = 0 then
    raise exception using errcode = 'P0001', message = 'PRINTER_NAME_REQUIRED';
  end if;

  select * into target_job
  from public.print_jobs job
  where job.id = p_print_job_id
  for update;

  if target_job.id is null then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_NOT_FOUND';
  end if;

  select * into target_session
  from public.packing_sessions session
  where session.id = target_job.packing_session_id
  for update;

  if target_session.operator_id <> auth.uid() and not (select private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_FORBIDDEN';
  end if;

  if target_job.status <> 'printing' then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_NOT_PRINTING';
  end if;

  new_attempt_no := target_job.attempt_count + 1;

  insert into public.print_attempts (
    print_job_id, attempt_no, printer_name, result, error_code, error_message_safe
  ) values (
    target_job.id, new_attempt_no, trim(p_printer_name), p_result,
    case when p_result = 'failed' then p_error_code end,
    case when p_result = 'failed' then p_error_message_safe end
  );

  if p_result = 'sent' then
    update public.print_jobs job
    set status = 'confirmed',
        attempt_count = new_attempt_no,
        sent_at = statement_timestamp(),
        confirmed_at = statement_timestamp()
    where job.id = target_job.id
    returning * into target_job;

    update public.packing_sessions session
    set status = 'confirmed'
    where session.id = target_session.id
    returning session.status into resulting_session_status;
  else
    update public.print_jobs job
    set status = 'failed', attempt_count = new_attempt_no
    where job.id = target_job.id
    returning * into target_job;

    update public.packing_sessions session
    set status = 'print_failed'
    where session.id = target_session.id
    returning session.status into resulting_session_status;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when p_result = 'sent' then 'print_attempt.sent' else 'print_attempt.failed' end,
    'print_job', target_job.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'packing_session_id', target_session.id,
      'attempt_no', new_attempt_no,
      'printer_name', trim(p_printer_name),
      'error_code', p_error_code
    ))
  );

  return query select
    target_job.id, target_session.id, target_job.status,
    resulting_session_status, new_attempt_no, target_job.label_reference;
end;
$$;

revoke execute on function public.claim_print_job(uuid, text) from public, anon;
revoke execute on function public.complete_print_job(uuid, public.print_attempt_result, text, text, text) from public, anon;
grant execute on function public.claim_print_job(uuid, text) to authenticated;
grant execute on function public.complete_print_job(uuid, public.print_attempt_result, text, text, text) to authenticated;
