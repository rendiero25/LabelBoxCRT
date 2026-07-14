create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create type public.user_role as enum ('admin', 'operator');
create type public.delivery_status as enum ('draft', 'active', 'closed', 'cancelled');
create type public.packing_session_status as enum (
  'draft',
  'scanning',
  'ready_to_finalize',
  'finalizing',
  'print_pending',
  'printing',
  'sent_to_printer',
  'confirmed',
  'print_failed',
  'cancelled',
  'expired'
);
create type public.scan_result as enum ('accepted', 'invalid', 'duplicate', 'over_qty');
create type public.print_job_status as enum (
  'pending',
  'printing',
  'sent',
  'confirmed',
  'failed',
  'cancelled'
);
create type public.print_attempt_result as enum ('sent', 'failed');
create type public.reprint_status as enum ('requested', 'approved', 'rejected', 'executed');

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

revoke execute on function private.set_updated_at() from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null check (btrim(display_name) <> ''),
  role public.user_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_code text not null check (btrim(supplier_code) <> ''),
  supplier_name text not null check (btrim(supplier_name) <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index suppliers_supplier_code_key
  on public.suppliers (lower(btrim(supplier_code)));

create table public.delivery_numbers (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  delivery_number text not null check (btrim(delivery_number) <> ''),
  delivery_date date not null,
  status public.delivery_status not null default 'draft',
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index delivery_numbers_supplier_number_idx
  on public.delivery_numbers (supplier_id, lower(btrim(delivery_number)));
create index delivery_numbers_created_by_idx on public.delivery_numbers (created_by);
create index delivery_numbers_status_date_idx
  on public.delivery_numbers (status, delivery_date desc);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  product_code text not null check (btrim(product_code) <> ''),
  part_name text not null check (btrim(part_name) <> ''),
  outer_diameter numeric not null check (outer_diameter > 0),
  inner_diameter numeric not null check (inner_diameter > 0),
  length numeric not null check (length > 0),
  normalized_dimensions text generated always as (
    lower(outer_diameter::text || 'x' || inner_diameter::text || 'x' || length::text)
  ) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index products_product_code_key
  on public.products (lower(btrim(product_code)));
create index products_normalized_dimensions_idx
  on public.products (normalized_dimensions);

create table public.master_items (
  id uuid primary key default gen_random_uuid(),
  item_code text not null check (btrim(item_code) <> ''),
  part_no text not null check (btrim(part_no) <> ''),
  part_name text not null check (btrim(part_name) <> ''),
  unit text not null check (btrim(unit) <> ''),
  default_label_qty integer not null default 100 check (default_label_qty > 0),
  item_sequence_code text check (
    item_sequence_code is null or btrim(item_sequence_code) <> ''
  ),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index master_items_item_code_key
  on public.master_items (lower(btrim(item_code)));
create unique index master_items_part_no_key
  on public.master_items (upper(btrim(part_no)));

create table public.master_item_products (
  id uuid primary key default gen_random_uuid(),
  master_item_id uuid not null references public.master_items (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint master_item_products_master_product_key
    unique (master_item_id, product_id)
);

create index master_item_products_product_idx
  on public.master_item_products (product_id);

create table public.box_definitions (
  id uuid primary key default gen_random_uuid(),
  master_item_id uuid not null references public.master_items (id) on delete restrict,
  box_code text not null check (btrim(box_code) <> ''),
  box_name text not null check (btrim(box_name) <> ''),
  version integer not null default 1 check (version > 0),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index box_definitions_master_code_version_key
  on public.box_definitions (master_item_id, lower(btrim(box_code)), version);
create unique index box_definitions_one_active_version_idx
  on public.box_definitions (master_item_id, lower(btrim(box_code)))
  where is_active;

create table public.box_layers (
  id uuid primary key default gen_random_uuid(),
  box_definition_id uuid not null references public.box_definitions (id) on delete restrict,
  layer_no integer not null check (layer_no > 0),
  layer_name text not null check (btrim(layer_name) <> ''),
  sort_order integer not null check (sort_order > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint box_layers_definition_layer_key unique (box_definition_id, layer_no),
  constraint box_layers_definition_sort_key unique (box_definition_id, sort_order)
);

create table public.box_layer_requirements (
  id uuid primary key default gen_random_uuid(),
  box_layer_id uuid not null references public.box_layers (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  expected_qty integer not null check (expected_qty > 0),
  sort_order integer not null check (sort_order > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint box_layer_requirements_layer_product_key
    unique (box_layer_id, product_id),
  constraint box_layer_requirements_layer_sort_key
    unique (box_layer_id, sort_order)
);

create index box_layer_requirements_product_idx
  on public.box_layer_requirements (product_id);

create table public.workstations (
  id uuid primary key default gen_random_uuid(),
  workstation_code text not null check (btrim(workstation_code) <> ''),
  name text not null check (btrim(name) <> ''),
  printer_name text check (printer_name is null or btrim(printer_name) <> ''),
  printer_model text not null default 'Zebra ZD220' check (btrim(printer_model) <> ''),
  scanner_model text not null default 'Zebra DS2208 2D' check (btrim(scanner_model) <> ''),
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index workstations_workstation_code_key
  on public.workstations (lower(btrim(workstation_code)));

create table public.workstation_assignments (
  id uuid primary key default gen_random_uuid(),
  workstation_id uuid not null references public.workstations (id) on delete restrict,
  operator_id uuid not null references public.profiles (id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workstation_assignments_workstation_operator_key
    unique (workstation_id, operator_id)
);

create index workstation_assignments_operator_idx
  on public.workstation_assignments (operator_id, workstation_id)
  where is_active;

create table public.packing_sessions (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.profiles (id) on delete restrict,
  workstation_id uuid not null references public.workstations (id) on delete restrict,
  master_item_id uuid not null references public.master_items (id) on delete restrict,
  box_definition_id uuid not null references public.box_definitions (id) on delete restrict,
  delivery_number_id uuid references public.delivery_numbers (id) on delete restrict,
  status public.packing_session_status not null default 'draft',
  started_at timestamptz not null default now(),
  ready_at timestamptz,
  finalized_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or btrim(cancel_reason) <> ''),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index packing_sessions_one_open_per_workstation_idx
  on public.packing_sessions (workstation_id)
  where status not in ('confirmed', 'cancelled', 'expired');
create index packing_sessions_operator_idx on public.packing_sessions (operator_id);
create index packing_sessions_master_item_idx on public.packing_sessions (master_item_id);
create index packing_sessions_box_definition_idx on public.packing_sessions (box_definition_id);
create index packing_sessions_delivery_number_idx on public.packing_sessions (delivery_number_id);
create index packing_sessions_status_idx on public.packing_sessions (status, started_at desc);

create table public.packing_session_scans (
  id uuid primary key default gen_random_uuid(),
  packing_session_id uuid not null references public.packing_sessions (id) on delete restrict,
  label_uid text check (label_uid is null or btrim(label_uid) <> ''),
  raw_payload_hash text not null check (btrim(raw_payload_hash) <> ''),
  scanned_part_no text not null check (btrim(scanned_part_no) <> ''),
  scanned_size text not null check (btrim(scanned_size) <> ''),
  normalized_size text not null check (btrim(normalized_size) <> ''),
  product_id uuid references public.products (id) on delete restrict,
  box_layer_id uuid references public.box_layers (id) on delete restrict,
  result public.scan_result not null,
  error_code text check (error_code is null or btrim(error_code) <> ''),
  scanned_by uuid not null references public.profiles (id) on delete restrict,
  workstation_id uuid not null references public.workstations (id) on delete restrict,
  correlation_id uuid not null default gen_random_uuid(),
  scanned_at timestamptz not null default now(),
  constraint packing_session_scans_accepted_fields_check check (
    result <> 'accepted'
    or (
      label_uid is not null
      and product_id is not null
      and box_layer_id is not null
      and error_code is null
    )
  )
);

create unique index packing_session_scans_accepted_label_uid_idx
  on public.packing_session_scans (label_uid)
  where result = 'accepted' and label_uid is not null;
create index packing_session_scans_session_idx
  on public.packing_session_scans (packing_session_id, scanned_at desc);
create index packing_session_scans_product_idx on public.packing_session_scans (product_id);
create index packing_session_scans_layer_idx on public.packing_session_scans (box_layer_id);
create index packing_session_scans_scanned_by_idx on public.packing_session_scans (scanned_by);
create index packing_session_scans_workstation_idx on public.packing_session_scans (workstation_id);

create table public.sequence_counters (
  scope_key text primary key check (btrim(scope_key) <> ''),
  current_value bigint not null default 0 check (current_value >= 0),
  updated_at timestamptz not null default now()
);

create table public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  packing_session_id uuid not null references public.packing_sessions (id) on delete restrict,
  parent_print_job_id uuid references public.print_jobs (id) on delete restrict,
  workstation_id uuid not null references public.workstations (id) on delete restrict,
  status public.print_job_status not null default 'pending',
  supplier_code_snapshot text not null check (btrim(supplier_code_snapshot) <> ''),
  supplier_name_snapshot text not null check (btrim(supplier_name_snapshot) <> ''),
  part_no_snapshot text not null check (btrim(part_no_snapshot) <> ''),
  part_name_snapshot text not null check (btrim(part_name_snapshot) <> ''),
  qty_snapshot integer not null check (qty_snapshot > 0),
  delivery_number_snapshot text not null check (btrim(delivery_number_snapshot) <> ''),
  delivery_date_snapshot date not null,
  box_code_snapshot text not null check (btrim(box_code_snapshot) <> ''),
  box_name_snapshot text not null check (btrim(box_name_snapshot) <> ''),
  sequence_no bigint not null check (sequence_no > 0),
  label_reference text not null check (btrim(label_reference) <> ''),
  template_version text not null check (btrim(template_version) <> ''),
  zpl_payload text not null check (btrim(zpl_payload) <> ''),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint print_jobs_parent_not_self_check check (parent_print_job_id is distinct from id)
);

create unique index print_jobs_one_initial_per_session_idx
  on public.print_jobs (packing_session_id)
  where parent_print_job_id is null;
create index print_jobs_parent_idx on public.print_jobs (parent_print_job_id);
create index print_jobs_workstation_status_idx
  on public.print_jobs (workstation_id, status, created_at);
create index print_jobs_created_by_idx on public.print_jobs (created_by);

create table public.print_attempts (
  id uuid primary key default gen_random_uuid(),
  print_job_id uuid not null references public.print_jobs (id) on delete restrict,
  attempt_no integer not null check (attempt_no > 0),
  workstation_id uuid not null references public.workstations (id) on delete restrict,
  printer_name text not null check (btrim(printer_name) <> ''),
  result public.print_attempt_result not null,
  error_code text check (error_code is null or btrim(error_code) <> ''),
  error_message_safe text check (
    error_message_safe is null or btrim(error_message_safe) <> ''
  ),
  created_at timestamptz not null default now(),
  constraint print_attempts_job_attempt_key unique (print_job_id, attempt_no)
);

create index print_attempts_workstation_idx on public.print_attempts (workstation_id);

create table public.reprint_requests (
  id uuid primary key default gen_random_uuid(),
  source_print_job_id uuid not null references public.print_jobs (id) on delete restrict,
  requested_by uuid not null references public.profiles (id) on delete restrict,
  reason text not null check (btrim(reason) <> ''),
  status public.reprint_status not null default 'requested',
  reviewed_by uuid references public.profiles (id) on delete restrict,
  review_note text check (review_note is null or btrim(review_note) <> ''),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint reprint_requests_review_state_check check (
    (status = 'requested' and reviewed_by is null and reviewed_at is null)
    or (status <> 'requested' and reviewed_by is not null and reviewed_at is not null)
  )
);

create unique index reprint_requests_one_open_per_source_idx
  on public.reprint_requests (source_print_job_id)
  where status in ('requested', 'approved');
create index reprint_requests_requested_by_idx on public.reprint_requests (requested_by);
create index reprint_requests_reviewed_by_idx on public.reprint_requests (reviewed_by);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete restrict,
  action text not null check (btrim(action) <> ''),
  entity_type text not null check (btrim(entity_type) <> ''),
  entity_id text check (entity_id is null or btrim(entity_id) <> ''),
  workstation_id uuid references public.workstations (id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_workstation_idx on public.audit_logs (workstation_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_correlation_idx on public.audit_logs (correlation_id);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger suppliers_set_updated_at
before update on public.suppliers
for each row execute function private.set_updated_at();

create trigger delivery_numbers_set_updated_at
before update on public.delivery_numbers
for each row execute function private.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function private.set_updated_at();

create trigger master_items_set_updated_at
before update on public.master_items
for each row execute function private.set_updated_at();

create trigger master_item_products_set_updated_at
before update on public.master_item_products
for each row execute function private.set_updated_at();

create trigger box_definitions_set_updated_at
before update on public.box_definitions
for each row execute function private.set_updated_at();

create trigger box_layers_set_updated_at
before update on public.box_layers
for each row execute function private.set_updated_at();

create trigger box_layer_requirements_set_updated_at
before update on public.box_layer_requirements
for each row execute function private.set_updated_at();

create trigger workstations_set_updated_at
before update on public.workstations
for each row execute function private.set_updated_at();

create trigger workstation_assignments_set_updated_at
before update on public.workstation_assignments
for each row execute function private.set_updated_at();

create trigger packing_sessions_set_updated_at
before update on public.packing_sessions
for each row execute function private.set_updated_at();

create trigger print_jobs_set_updated_at
before update on public.print_jobs
for each row execute function private.set_updated_at();

create trigger reprint_requests_set_updated_at
before update on public.reprint_requests
for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.suppliers enable row level security;
alter table public.suppliers force row level security;
alter table public.delivery_numbers enable row level security;
alter table public.delivery_numbers force row level security;
alter table public.products enable row level security;
alter table public.products force row level security;
alter table public.master_items enable row level security;
alter table public.master_items force row level security;
alter table public.master_item_products enable row level security;
alter table public.master_item_products force row level security;
alter table public.box_definitions enable row level security;
alter table public.box_definitions force row level security;
alter table public.box_layers enable row level security;
alter table public.box_layers force row level security;
alter table public.box_layer_requirements enable row level security;
alter table public.box_layer_requirements force row level security;
alter table public.workstations enable row level security;
alter table public.workstations force row level security;
alter table public.workstation_assignments enable row level security;
alter table public.workstation_assignments force row level security;
alter table public.packing_sessions enable row level security;
alter table public.packing_sessions force row level security;
alter table public.packing_session_scans enable row level security;
alter table public.packing_session_scans force row level security;
alter table public.sequence_counters enable row level security;
alter table public.sequence_counters force row level security;
alter table public.print_jobs enable row level security;
alter table public.print_jobs force row level security;
alter table public.print_attempts enable row level security;
alter table public.print_attempts force row level security;
alter table public.reprint_requests enable row level security;
alter table public.reprint_requests force row level security;
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges in schema public
revoke all on tables from anon, authenticated;
alter default privileges in schema public
revoke all on sequences from anon, authenticated;
alter default privileges in schema public
revoke execute on functions from public, anon, authenticated;

create or replace function private.is_active_admin()
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function private.is_active_operator()
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'operator' and is_active
  );
$$;

create or replace function private.is_assigned_to_workstation(target_workstation_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select private.is_active_operator()
    and exists (
      select 1
      from public.workstation_assignments assignment
      join public.workstations workstation on workstation.id = assignment.workstation_id
      where assignment.operator_id = auth.uid()
        and assignment.workstation_id = target_workstation_id
        and assignment.is_active and workstation.is_active
    );
$$;

revoke execute on function private.is_active_admin() from public, anon;
revoke execute on function private.is_active_operator() from public, anon;
revoke execute on function private.is_assigned_to_workstation(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_active_admin() to authenticated;
grant execute on function private.is_active_operator() to authenticated;
grant execute on function private.is_assigned_to_workstation(uuid) to authenticated;

grant select on table public.profiles, public.suppliers, public.delivery_numbers,
  public.products, public.master_items, public.master_item_products,
  public.box_definitions, public.box_layers, public.box_layer_requirements,
  public.workstations, public.workstation_assignments, public.packing_sessions,
  public.packing_session_scans, public.print_jobs, public.print_attempts,
  public.reprint_requests, public.audit_logs to authenticated;

grant insert, update, delete on table public.profiles, public.suppliers,
  public.delivery_numbers, public.products, public.master_items,
  public.master_item_products, public.box_definitions, public.box_layers,
  public.box_layer_requirements, public.workstations,
  public.workstation_assignments to authenticated;

create policy profiles_select on public.profiles for select to authenticated
using ((select private.is_active_admin()) or (id = (select auth.uid()) and is_active));

create policy suppliers_select on public.suppliers for select to authenticated
using ((select private.is_active_admin()) or ((select private.is_active_operator()) and is_active));

create policy delivery_numbers_select on public.delivery_numbers for select to authenticated
using (
  (select private.is_active_admin())
  or ((select private.is_active_operator()) and status = 'active' and exists (
    select 1 from public.suppliers supplier
    where supplier.id = delivery_numbers.supplier_id and supplier.is_active
  ))
);

create policy products_select on public.products for select to authenticated
using ((select private.is_active_admin()) or ((select private.is_active_operator()) and is_active));

create policy master_items_select on public.master_items for select to authenticated
using ((select private.is_active_admin()) or ((select private.is_active_operator()) and is_active));

create policy master_item_products_select on public.master_item_products for select to authenticated
using (
  (select private.is_active_admin())
  or ((select private.is_active_operator()) and is_active
    and exists (select 1 from public.master_items item where item.id = master_item_products.master_item_id and item.is_active)
    and exists (select 1 from public.products product where product.id = master_item_products.product_id and product.is_active))
);

create policy box_definitions_select on public.box_definitions for select to authenticated
using (
  (select private.is_active_admin())
  or ((select private.is_active_operator()) and is_active
    and exists (select 1 from public.master_items item where item.id = box_definitions.master_item_id and item.is_active))
);

create policy box_layers_select on public.box_layers for select to authenticated
using (
  (select private.is_active_admin())
  or ((select private.is_active_operator()) and is_active and exists (
    select 1 from public.box_definitions definition
    join public.master_items item on item.id = definition.master_item_id
    where definition.id = box_layers.box_definition_id and definition.is_active and item.is_active
  ))
);

create policy box_layer_requirements_select on public.box_layer_requirements for select to authenticated
using (
  (select private.is_active_admin())
  or ((select private.is_active_operator()) and exists (
    select 1
    from public.box_layers layer
    join public.box_definitions definition on definition.id = layer.box_definition_id
    join public.master_items item on item.id = definition.master_item_id
    join public.products product on product.id = box_layer_requirements.product_id
    join public.master_item_products mapping
      on mapping.master_item_id = definition.master_item_id
      and mapping.product_id = box_layer_requirements.product_id
    where layer.id = box_layer_requirements.box_layer_id and layer.is_active
      and definition.is_active and item.is_active and product.is_active and mapping.is_active
  ))
);

create policy workstations_select on public.workstations for select to authenticated
using ((select private.is_active_admin()) or (is_active and (select private.is_assigned_to_workstation(id))));

create policy workstation_assignments_select on public.workstation_assignments for select to authenticated
using (
  (select private.is_active_admin())
  or (operator_id = (select auth.uid()) and is_active
    and (select private.is_assigned_to_workstation(workstation_id)))
);

create policy packing_sessions_select on public.packing_sessions for select to authenticated
using (
  (select private.is_active_admin())
  or (operator_id = (select auth.uid()) and (select private.is_assigned_to_workstation(workstation_id)))
);

create policy packing_session_scans_select on public.packing_session_scans for select to authenticated
using (
  (select private.is_active_admin())
  or (scanned_by = (select auth.uid()) and (select private.is_assigned_to_workstation(workstation_id)) and exists (
    select 1 from public.packing_sessions session
    where session.id = packing_session_scans.packing_session_id
      and session.operator_id = auth.uid()
      and session.workstation_id = packing_session_scans.workstation_id
  ))
);

create policy print_jobs_select on public.print_jobs for select to authenticated
using ((select private.is_active_admin()) or (select private.is_assigned_to_workstation(workstation_id)));

create policy print_attempts_select on public.print_attempts for select to authenticated
using (
  (select private.is_active_admin())
  or ((select private.is_assigned_to_workstation(workstation_id)) and exists (
    select 1 from public.print_jobs job
    where job.id = print_attempts.print_job_id and job.workstation_id = print_attempts.workstation_id
  ))
);

create policy reprint_requests_select on public.reprint_requests for select to authenticated
using (
  (select private.is_active_admin())
  or (requested_by = (select auth.uid()) and exists (
    select 1 from public.print_jobs job
    where job.id = reprint_requests.source_print_job_id
      and (select private.is_assigned_to_workstation(job.workstation_id))
  ))
);

create policy audit_logs_select on public.audit_logs for select to authenticated
using ((select private.is_active_admin()));

create policy sequence_counters_no_direct_access
on public.sequence_counters for all to authenticated
using (false)
with check (false);

do $$
declare relation_name text;
begin
  foreach relation_name in array array[
    'profiles', 'suppliers', 'delivery_numbers', 'products', 'master_items',
    'master_item_products', 'box_definitions', 'box_layers',
    'box_layer_requirements', 'workstations', 'workstation_assignments'
  ] loop
    execute format('create policy %1$I_insert on public.%1$I for insert to authenticated with check ((select private.is_active_admin()))', relation_name);
    execute format('create policy %1$I_update on public.%1$I for update to authenticated using ((select private.is_active_admin())) with check ((select private.is_active_admin()))', relation_name);
    execute format('create policy %1$I_delete on public.%1$I for delete to authenticated using ((select private.is_active_admin()))', relation_name);
  end loop;
end;
$$;

create or replace function private.validate_box_definition(target_box_definition_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  errors text[] := array[]::text[];
  target_master_item_id uuid;
begin
  select definition.master_item_id into target_master_item_id
  from public.box_definitions definition
  join public.master_items item on item.id = definition.master_item_id
  where definition.id = target_box_definition_id and item.is_active;

  if target_master_item_id is null then
    errors := array_append(errors, 'BOX_DEFINITION_OR_ACTIVE_MASTER_ITEM_NOT_FOUND');
  end if;
  if not exists (select 1 from public.box_layers layer where layer.box_definition_id = target_box_definition_id and layer.is_active) then
    errors := array_append(errors, 'ACTIVE_LAYER_REQUIRED');
  end if;
  if exists (
    select 1 from public.box_layers layer
    where layer.box_definition_id = target_box_definition_id and layer.is_active
      and not exists (select 1 from public.box_layer_requirements requirement where requirement.box_layer_id = layer.id)
  ) then
    errors := array_append(errors, 'LAYER_REQUIREMENT_REQUIRED');
  end if;
  if exists (
    select 1
    from public.box_layers layer
    join public.box_layer_requirements requirement on requirement.box_layer_id = layer.id
    left join public.products product on product.id = requirement.product_id and product.is_active
    left join public.master_item_products mapping
      on mapping.master_item_id = target_master_item_id
      and mapping.product_id = requirement.product_id and mapping.is_active
    where layer.box_definition_id = target_box_definition_id and layer.is_active
      and (product.id is null or mapping.id is null)
  ) then
    errors := array_append(errors, 'PRODUCT_NOT_ACTIVE_OR_ALLOWED');
  end if;
  return jsonb_build_object('valid', cardinality(errors) = 0, 'errors', to_jsonb(errors));
end;
$$;

create or replace function private.activate_box_definition(target_box_definition_id uuid, target_correlation_id uuid)
returns uuid language plpgsql volatile security definer
set search_path = pg_catalog, public
as $$
declare
  target_definition public.box_definitions%rowtype;
  validation_result jsonb;
begin
  if not private.is_active_admin() then
    raise exception using errcode = '42501', message = 'BOX_ACTIVATION_NOT_AUTHORIZED';
  end if;
  select * into target_definition from public.box_definitions
  where id = target_box_definition_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'BOX_DEFINITION_NOT_FOUND';
  end if;
  validation_result := private.validate_box_definition(target_box_definition_id);
  if not coalesce((validation_result ->> 'valid')::boolean, false) then
    raise exception using errcode = '22023', message = 'BOX_DEFINITION_INVALID', detail = validation_result::text;
  end if;
  update public.box_definitions set is_active = false
  where master_item_id = target_definition.master_item_id
    and lower(btrim(box_code)) = lower(btrim(target_definition.box_code))
    and id <> target_box_definition_id and is_active;
  update public.box_definitions set is_active = true where id = target_box_definition_id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata, correlation_id)
  values (
    auth.uid(), 'box_definition.activated', 'box_definition', target_box_definition_id::text,
    jsonb_build_object('box_code', target_definition.box_code, 'version', target_definition.version),
    target_correlation_id
  );
  return target_box_definition_id;
end;
$$;

revoke execute on function private.validate_box_definition(uuid) from public, anon, authenticated;
revoke execute on function private.activate_box_definition(uuid, uuid) from public, anon;
grant execute on function private.activate_box_definition(uuid, uuid) to authenticated;
