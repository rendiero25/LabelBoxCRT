create type public.workstation_approval_status as enum (
  'pending',
  'approved',
  'disabled'
);

alter table public.workstations
  add column approval_status public.workstation_approval_status not null default 'pending',
  add column approved_by uuid references public.profiles (id) on delete restrict,
  add column approved_at timestamptz,
  add column disabled_by uuid references public.profiles (id) on delete restrict,
  add column disabled_at timestamptz,
  add column disabled_reason text check (
    disabled_reason is null or btrim(disabled_reason) <> ''
  );

-- Existing active rows predate enrollment. Keep them operable while requiring
-- every new workstation to complete registration, enrollment, then approval.
update public.workstations
set approval_status = case when is_active then 'approved' else 'disabled' end
where approval_status = 'pending';

alter table public.workstations
  alter column is_active set default false;

create index workstations_approval_status_idx
  on public.workstations (approval_status, last_seen_at desc);

create table private.workstation_enrollments (
  id uuid primary key default gen_random_uuid(),
  workstation_id uuid not null references public.workstations (id) on delete restrict,
  token_hash text not null unique check (btrim(token_hash) <> ''),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references public.profiles (id) on delete restrict,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create unique index workstation_enrollments_one_open_idx
  on private.workstation_enrollments (workstation_id)
  where consumed_at is null;

create table private.workstation_device_credentials (
  id uuid primary key default gen_random_uuid(),
  workstation_id uuid not null references public.workstations (id) on delete restrict,
  token_hash text not null unique check (btrim(token_hash) <> ''),
  enrolled_by uuid not null references public.profiles (id) on delete restrict,
  enrolled_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete restrict
);

create unique index workstation_device_credentials_one_active_idx
  on private.workstation_device_credentials (workstation_id)
  where revoked_at is null;

revoke all on table private.workstation_enrollments,
  private.workstation_device_credentials from public, anon, authenticated;

create or replace function private.workstation_token_hash(raw_token text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select encode(extensions.digest(raw_token, 'sha256'), 'hex');
$$;

create or replace function public.register_workstation(
  p_workstation_code text,
  p_name text,
  p_printer_name text,
  p_printer_model text,
  p_scanner_model text,
  p_operator_id uuid
)
returns table (
  workstation_id uuid,
  enrollment_code text,
  enrollment_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_code text := upper(btrim(p_workstation_code));
  normalized_name text := btrim(p_name);
  normalized_printer_name text := btrim(p_printer_name);
  normalized_printer_model text := btrim(p_printer_model);
  normalized_scanner_model text := btrim(p_scanner_model);
  raw_enrollment_code text;
  created_workstation_id uuid;
  expiry timestamptz := statement_timestamp() + interval '24 hours';
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_ADMIN_REQUIRED';
  end if;

  if normalized_code !~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'
    or normalized_name = ''
    or normalized_printer_name = ''
    or normalized_printer_model = ''
    or normalized_scanner_model = '' then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_INPUT_INVALID';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_operator_id and role = 'operator' and is_active
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_OPERATOR_INVALID';
  end if;

  begin
    insert into public.workstations (
      workstation_code, name, printer_name, printer_model, scanner_model,
      is_active, approval_status
    ) values (
      normalized_code, normalized_name, normalized_printer_name,
      normalized_printer_model, normalized_scanner_model, false, 'pending'
    ) returning id into created_workstation_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_CODE_EXISTS';
  end;

  insert into public.workstation_assignments (workstation_id, operator_id, is_active)
  values (created_workstation_id, p_operator_id, true);

  raw_enrollment_code := replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '');

  insert into private.workstation_enrollments (
    workstation_id, token_hash, expires_at, created_by
  ) values (
    created_workstation_id,
    private.workstation_token_hash(raw_enrollment_code),
    expiry,
    auth.uid()
  );

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, workstation_id, metadata
  ) values (
    auth.uid(), 'workstation.registered', 'workstation',
    created_workstation_id::text, created_workstation_id,
    jsonb_build_object('workstation_code', normalized_code, 'operator_id', p_operator_id)
  );

  return query select created_workstation_id, raw_enrollment_code, expiry;
end;
$$;

create or replace function public.enroll_workstation(p_enrollment_code text)
returns table (workstation_id uuid, device_token text)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  enrollment private.workstation_enrollments%rowtype;
  raw_device_token text;
begin
  if not private.is_active_operator() then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_OPERATOR_REQUIRED';
  end if;

  select * into enrollment
  from private.workstation_enrollments
  where token_hash = private.workstation_token_hash(btrim(p_enrollment_code))
  for update;

  if enrollment.id is null
    or enrollment.consumed_at is not null
    or enrollment.expires_at <= statement_timestamp() then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_ENROLLMENT_INVALID';
  end if;

  if not exists (
    select 1 from public.workstation_assignments
    where workstation_id = enrollment.workstation_id
      and operator_id = auth.uid()
      and is_active
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_NOT_ASSIGNED';
  end if;

  if exists (
    select 1 from private.workstation_device_credentials
    where workstation_id = enrollment.workstation_id and revoked_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_ALREADY_ENROLLED';
  end if;

  raw_device_token := replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '');

  insert into private.workstation_device_credentials (
    workstation_id, token_hash, enrolled_by
  ) values (
    enrollment.workstation_id,
    private.workstation_token_hash(raw_device_token),
    auth.uid()
  );

  update private.workstation_enrollments
  set consumed_at = statement_timestamp(), consumed_by = auth.uid()
  where id = enrollment.id;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, workstation_id, metadata
  ) values (
    auth.uid(), 'workstation.enrolled', 'workstation',
    enrollment.workstation_id::text, enrollment.workstation_id, '{}'::jsonb
  );

  return query select enrollment.workstation_id, raw_device_token;
end;
$$;

create or replace function public.approve_workstation(p_workstation_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_ADMIN_REQUIRED';
  end if;

  if not exists (
    select 1 from private.workstation_device_credentials
    where workstation_id = p_workstation_id and revoked_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_NOT_ENROLLED';
  end if;

  update public.workstations
  set approval_status = 'approved', is_active = true,
      approved_by = auth.uid(), approved_at = statement_timestamp(),
      disabled_by = null, disabled_at = null, disabled_reason = null
  where id = p_workstation_id and approval_status = 'pending';

  if not found then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_NOT_PENDING';
  end if;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, workstation_id, metadata
  ) values (
    auth.uid(), 'workstation.approved', 'workstation',
    p_workstation_id::text, p_workstation_id, '{}'::jsonb
  );
end;
$$;

create or replace function public.disable_workstation(
  p_workstation_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_reason text := btrim(p_reason);
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_ADMIN_REQUIRED';
  end if;

  if normalized_reason = '' then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_DISABLE_REASON_REQUIRED';
  end if;

  update public.workstations
  set approval_status = 'disabled', is_active = false,
      disabled_by = auth.uid(), disabled_at = statement_timestamp(),
      disabled_reason = normalized_reason
  where id = p_workstation_id and approval_status <> 'disabled';

  if not found then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_NOT_FOUND_OR_DISABLED';
  end if;

  update private.workstation_device_credentials
  set revoked_at = statement_timestamp(), revoked_by = auth.uid()
  where workstation_id = p_workstation_id and revoked_at is null;

  update private.workstation_enrollments
  set consumed_at = statement_timestamp(), consumed_by = auth.uid()
  where workstation_id = p_workstation_id and consumed_at is null;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, workstation_id, metadata
  ) values (
    auth.uid(), 'workstation.disabled', 'workstation',
    p_workstation_id::text, p_workstation_id,
    jsonb_build_object('reason', normalized_reason)
  );
end;
$$;

create or replace function public.workstation_heartbeat(p_device_token_hash text)
returns table (
  workstation_id uuid,
  workstation_code text,
  printer_name text,
  printer_model text,
  scanner_model text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  credential private.workstation_device_credentials%rowtype;
  workstation public.workstations%rowtype;
begin
  if not private.is_active_operator() then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_OPERATOR_REQUIRED';
  end if;

  select * into credential
  from private.workstation_device_credentials
  where token_hash = p_device_token_hash and revoked_at is null;

  if credential.id is null then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_DEVICE_INVALID';
  end if;

  select * into workstation
  from public.workstations
  where id = credential.workstation_id;

  if workstation.id is null
    or workstation.approval_status <> 'approved'
    or not workstation.is_active then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_NOT_APPROVED';
  end if;

  if not exists (
    select 1 from public.workstation_assignments assignment
    where assignment.workstation_id = workstation.id
      and assignment.operator_id = auth.uid()
      and assignment.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSTATION_NOT_ASSIGNED';
  end if;

  update public.workstations
  set last_seen_at = statement_timestamp()
  where id = workstation.id;

  update private.workstation_device_credentials
  set last_seen_at = statement_timestamp()
  where id = credential.id;

  return query select workstation.id, workstation.workstation_code,
    workstation.printer_name, workstation.printer_model, workstation.scanner_model;
end;
$$;

create or replace function public.list_workstations_for_admin()
returns table (
  id uuid,
  workstation_code text,
  name text,
  printer_name text,
  printer_model text,
  scanner_model text,
  approval_status public.workstation_approval_status,
  is_active boolean,
  last_seen_at timestamptz,
  assigned_operator_id uuid,
  has_active_device boolean
)
language sql
security definer
set search_path = pg_catalog
as $$
  select workstation.id, workstation.workstation_code, workstation.name,
    workstation.printer_name, workstation.printer_model, workstation.scanner_model,
    workstation.approval_status, workstation.is_active, workstation.last_seen_at,
    assignment.operator_id,
    exists (
      select 1 from private.workstation_device_credentials credential
      where credential.workstation_id = workstation.id and credential.revoked_at is null
    )
  from public.workstations workstation
  left join public.workstation_assignments assignment
    on assignment.workstation_id = workstation.id and assignment.is_active
  where private.is_active_admin()
  order by workstation.created_at desc;
$$;

revoke execute on function private.workstation_token_hash(text) from public, anon, authenticated;
revoke execute on function public.register_workstation(text, text, text, text, text, uuid) from public, anon;
revoke execute on function public.enroll_workstation(text) from public, anon;
revoke execute on function public.approve_workstation(uuid) from public, anon;
revoke execute on function public.disable_workstation(uuid, text) from public, anon;
revoke execute on function public.workstation_heartbeat(text) from public, anon;
revoke execute on function public.list_workstations_for_admin() from public, anon;

grant execute on function public.register_workstation(text, text, text, text, text, uuid) to authenticated;
grant execute on function public.enroll_workstation(text) to authenticated;
grant execute on function public.approve_workstation(uuid) to authenticated;
grant execute on function public.disable_workstation(uuid, text) to authenticated;
grant execute on function public.workstation_heartbeat(text) to authenticated;
grant execute on function public.list_workstations_for_admin() to authenticated;
