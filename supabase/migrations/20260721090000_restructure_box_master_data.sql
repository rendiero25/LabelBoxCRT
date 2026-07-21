-- Box shape becomes reusable master data (like products): a Box (code, name,
-- layer shape) no longer belongs to a single Master Item. Master Item now
-- "adopts" an existing Box and assigns products+qty per layer; that
-- assignment (master_item_boxes) is what carries the version/draft/publish
-- flow that used to live directly on box_definitions.
--
-- box_definitions splits into:
--   boxes              -- shape master data: box_code, box_name, is_active
--   box_layers         -- shape, now keyed by box_id instead of box_definition_id
--   master_item_boxes  -- the assignment: master_item_id + box_id + version + is_active
--   box_layer_requirements -- re-keyed to (master_item_box_id, box_layer_id):
--                             same layer shape can carry different product/qty
--                             per master item that adopts the box.

-- 1. New tables ---------------------------------------------------------

create table public.boxes (
  id uuid primary key default gen_random_uuid(),
  box_code text not null check (btrim(box_code) <> ''),
  box_name text not null check (btrim(box_name) <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index boxes_box_code_key
  on public.boxes (lower(btrim(box_code)));

create trigger boxes_set_updated_at
before update on public.boxes
for each row execute function private.set_updated_at();

create table public.master_item_boxes (
  id uuid primary key default gen_random_uuid(),
  master_item_id uuid not null references public.master_items (id) on delete restrict,
  box_id uuid not null references public.boxes (id) on delete restrict,
  version integer not null default 1 check (version > 0),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index master_item_boxes_item_box_version_key
  on public.master_item_boxes (master_item_id, box_id, version);
create unique index master_item_boxes_one_active_idx
  on public.master_item_boxes (master_item_id, box_id)
  where is_active;

create trigger master_item_boxes_set_updated_at
before update on public.master_item_boxes
for each row execute function private.set_updated_at();

-- 2. Data migration -------------------------------------------------------
-- box_definitions today is (box shape) + (master item assignment) fused,
-- one row per version. Split it: one boxes row per distinct box_code
-- (preferring the most-recently-versioned row's name/active flag), one
-- master_item_boxes row per box_definitions row, and remap box_layers /
-- box_layer_requirements accordingly.

insert into public.boxes (box_code, box_name, is_active, created_at, updated_at)
select distinct on (lower(btrim(box_code)))
  box_code, box_name, is_active, created_at, updated_at
from public.box_definitions
order by lower(btrim(box_code)), version desc;

alter table public.master_item_boxes add column source_box_definition_id uuid;

insert into public.master_item_boxes (
  master_item_id, box_id, version, is_active, created_at, updated_at,
  source_box_definition_id
)
select
  d.master_item_id, b.id, d.version, d.is_active, d.created_at, d.updated_at, d.id
from public.box_definitions d
join public.boxes b on lower(btrim(b.box_code)) = lower(btrim(d.box_code));

alter table public.box_layers add column box_id uuid references public.boxes (id) on delete restrict;

update public.box_layers layer
set box_id = b.id
from public.box_definitions d
join public.boxes b on lower(btrim(b.box_code)) = lower(btrim(d.box_code))
where layer.box_definition_id = d.id;

-- Different versions of the same box_code family currently have their own
-- (identical, cloned) box_layers rows. Collapse to one canonical row per
-- (box_id, layer_no), preferring the active version's layer, then the
-- highest version.
create temporary table canonical_box_layers as
select distinct on (layer.box_id, layer.layer_no)
  layer.id as canonical_id, layer.box_id, layer.layer_no
from public.box_layers layer
join public.box_definitions d on d.id = layer.box_definition_id
order by layer.box_id, layer.layer_no, d.is_active desc, d.version desc;

alter table public.box_layer_requirements add column master_item_box_id uuid;

update public.box_layer_requirements req
set master_item_box_id = mib.id
from public.box_layers layer
join public.master_item_boxes mib on mib.source_box_definition_id = layer.box_definition_id
where req.box_layer_id = layer.id;

update public.box_layer_requirements req
set box_layer_id = canonical.canonical_id
from public.box_layers old_layer
join canonical_box_layers canonical
  on canonical.box_id = old_layer.box_id and canonical.layer_no = old_layer.layer_no
where req.box_layer_id = old_layer.id;

delete from public.box_layers layer
where layer.id not in (select canonical_id from canonical_box_layers);

drop table canonical_box_layers;

alter table public.master_item_boxes drop column source_box_definition_id;

-- Old select policies reference box_layers.box_definition_id directly;
-- drop them before the column drop below (replacement policies created in
-- section 7 once boxes/master_item_boxes fully exist).
drop policy box_layers_select on public.box_layers;
drop policy box_layer_requirements_select on public.box_layer_requirements;

-- 3. Finish box_layers re-key ---------------------------------------------

alter table public.box_layers alter column box_id set not null;
alter table public.box_layers drop constraint box_layers_definition_layer_key;
alter table public.box_layers drop constraint box_layers_definition_sort_key;
alter table public.box_layers add constraint box_layers_box_layer_key unique (box_id, layer_no);
alter table public.box_layers add constraint box_layers_box_sort_key unique (box_id, sort_order);
alter table public.box_layers drop column box_definition_id;

-- 4. Finish box_layer_requirements re-key ----------------------------------

alter table public.box_layer_requirements alter column master_item_box_id set not null;
alter table public.box_layer_requirements
  add constraint box_layer_requirements_master_item_box_id_fkey
  foreign key (master_item_box_id) references public.master_item_boxes (id) on delete restrict;
alter table public.box_layer_requirements drop constraint box_layer_requirements_layer_product_key;
alter table public.box_layer_requirements drop constraint box_layer_requirements_layer_sort_key;
alter table public.box_layer_requirements
  add constraint box_layer_requirements_assignment_layer_product_key
  unique (master_item_box_id, box_layer_id, product_id);
alter table public.box_layer_requirements
  add constraint box_layer_requirements_assignment_layer_sort_key
  unique (master_item_box_id, box_layer_id, sort_order);

create index box_layer_requirements_master_item_box_idx
  on public.box_layer_requirements (master_item_box_id);

-- 5. Repoint packing_sessions -----------------------------------------------

alter table public.packing_sessions rename column box_definition_id to master_item_box_id;
alter table public.packing_sessions
  drop constraint packing_sessions_box_definition_id_fkey;
alter table public.packing_sessions
  add constraint packing_sessions_master_item_box_id_fkey
  foreign key (master_item_box_id) references public.master_item_boxes (id) on delete restrict;
alter index packing_sessions_box_definition_idx
  rename to packing_sessions_master_item_box_idx;

-- 6. Drop the old fused table and its box-specific functions ---------------

drop function if exists private.activate_box_definition(uuid, uuid);
drop function if exists private.validate_box_definition(uuid);
drop function if exists private.validate_box_definition_payload(uuid, jsonb);
drop function if exists private.persist_box_definition_layers(uuid, jsonb);
drop function if exists private.normalize_master_item_box_requirement_payload(jsonb);
drop function if exists private.sync_master_item_product_mappings(uuid, jsonb);
drop function if exists public.create_box_definition(uuid, text, text, jsonb);
drop function if exists public.update_box_definition(uuid, text, text, jsonb);
drop function if exists public.publish_box_definition(uuid);
drop function if exists public.clone_box_definition_version(uuid);
drop function if exists public.save_master_item_box_requirements(uuid, uuid, jsonb);

drop table public.box_definitions;

-- 7. RLS ---------------------------------------------------------------

alter table public.boxes enable row level security;
alter table public.boxes force row level security;
alter table public.master_item_boxes enable row level security;
alter table public.master_item_boxes force row level security;

grant select on table public.boxes, public.master_item_boxes to authenticated;
grant insert, update, delete on table public.boxes, public.master_item_boxes to authenticated;

create policy boxes_select on public.boxes for select to authenticated
using ((select private.is_active_admin()) or ((select private.is_active_operator()) and is_active));

create policy master_item_boxes_select on public.master_item_boxes for select to authenticated
using (
  (select private.is_active_admin())
  or ((select private.is_active_operator()) and is_active
    and exists (select 1 from public.master_items item where item.id = master_item_boxes.master_item_id and item.is_active)
    and exists (select 1 from public.boxes box where box.id = master_item_boxes.box_id and box.is_active))
);

-- box_layers/box_layer_requirements policies referenced box_definitions;
-- replace with the new shape via boxes / master_item_boxes (old versions
-- were already dropped above, before the box_definition_id column drop).
create policy box_layers_select on public.box_layers for select to authenticated
using (
  (select private.is_active_admin())
  or ((select private.is_active_operator()) and is_active and exists (
    select 1 from public.boxes box
    where box.id = box_layers.box_id and box.is_active
  ))
);

create policy box_layer_requirements_select on public.box_layer_requirements for select to authenticated
using (
  (select private.is_active_admin())
  or ((select private.is_active_operator()) and exists (
    select 1
    from public.box_layers layer
    join public.boxes box on box.id = layer.box_id
    join public.master_item_boxes mib on mib.id = box_layer_requirements.master_item_box_id
    join public.master_items item on item.id = mib.master_item_id
    join public.products product on product.id = box_layer_requirements.product_id
    join public.master_item_products mapping
      on mapping.master_item_id = mib.master_item_id
      and mapping.product_id = box_layer_requirements.product_id
    where layer.id = box_layer_requirements.box_layer_id and layer.is_active
      and box.is_active and mib.is_active and item.is_active
      and product.is_active and mapping.is_active
  ))
);

-- No insert/update/delete policies for boxes / master_item_boxes /
-- box_layers / box_layer_requirements: all mutation happens through
-- SECURITY DEFINER RPCs only, same as the box_definitions convention it
-- replaces (box_definition_admin_crud.sql dropped those policies outright).

-- 8. Box (shape) master-data RPCs ------------------------------------------

create or replace function private.validate_box_layers_payload(
  p_layers jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  layer_record record;
  normalized_layer_name text;
begin
  if coalesce(jsonb_typeof(p_layers), '') <> 'array'
    or jsonb_array_length(p_layers) = 0
    or jsonb_array_length(p_layers) > 10 then
    raise exception using errcode = 'P0001', message = 'BOX_INPUT_INVALID';
  end if;

  for layer_record in
    select layer.value
    from jsonb_array_elements(p_layers) as layer(value)
  loop
    if jsonb_typeof(layer_record.value) <> 'object'
      or jsonb_typeof(layer_record.value -> 'name') <> 'string' then
      raise exception using errcode = 'P0001', message = 'BOX_INPUT_INVALID';
    end if;

    normalized_layer_name := btrim(layer_record.value ->> 'name');
    if normalized_layer_name = '' or char_length(normalized_layer_name) > 200 then
      raise exception using errcode = 'P0001', message = 'BOX_INPUT_INVALID';
    end if;
  end loop;
end;
$$;

create or replace function private.persist_box_layers(
  p_box_id uuid,
  p_layers jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  layer_record record;
begin
  for layer_record in
    select layer.value, layer.ordinality
    from jsonb_array_elements(p_layers) with ordinality as layer(value, ordinality)
  loop
    insert into public.box_layers (
      box_id, layer_no, layer_name, sort_order
    ) values (
      p_box_id,
      layer_record.ordinality::integer,
      btrim(layer_record.value ->> 'name'),
      layer_record.ordinality::integer
    );
  end loop;
end;
$$;

create or replace function public.create_box(
  p_box_code text,
  p_box_name text,
  p_layers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_box_code text := upper(btrim(p_box_code));
  normalized_box_name text := btrim(p_box_name);
  target_box_id uuid;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'BOX_ADMIN_REQUIRED';
  end if;

  if normalized_box_code = ''
    or char_length(normalized_box_code) > 64
    or normalized_box_name = ''
    or char_length(normalized_box_name) > 200 then
    raise exception using errcode = 'P0001', message = 'BOX_INPUT_INVALID';
  end if;

  perform private.validate_box_layers_payload(p_layers);

  begin
    insert into public.boxes (box_code, box_name)
    values (normalized_box_code, normalized_box_name)
    returning id into target_box_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'BOX_CODE_EXISTS';
  end;

  perform private.persist_box_layers(target_box_id, p_layers);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'box.created', 'box', target_box_id::text,
    jsonb_build_object('box_code', normalized_box_code)
  );

  return target_box_id;
end;
$$;

create or replace function public.update_box(
  p_box_id uuid,
  p_box_code text,
  p_box_name text,
  p_layers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_box_code text := upper(btrim(p_box_code));
  normalized_box_name text := btrim(p_box_name);
  box_in_use boolean;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'BOX_ADMIN_REQUIRED';
  end if;

  if normalized_box_code = ''
    or char_length(normalized_box_code) > 64
    or normalized_box_name = ''
    or char_length(normalized_box_name) > 200 then
    raise exception using errcode = 'P0001', message = 'BOX_INPUT_INVALID';
  end if;

  if not exists (select 1 from public.boxes where id = p_box_id for update) then
    raise exception using errcode = 'P0001', message = 'BOX_NOT_FOUND';
  end if;

  select exists (
    select 1 from public.master_item_boxes where box_id = p_box_id
  ) into box_in_use;

  -- Layer shape is shared across every master item that adopted this box;
  -- once any master item has, changing layer count/names would orphan
  -- their per-layer product assignments. Lock layers, but code/name stay
  -- editable (matches Product: only actual usage blocks a field, and here
  -- the layer *shape* is the thing that must not move under an assignment).
  if not box_in_use then
    perform private.validate_box_layers_payload(p_layers);
  end if;

  begin
    update public.boxes
    set box_code = normalized_box_code, box_name = normalized_box_name
    where id = p_box_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'BOX_CODE_EXISTS';
  end;

  if not box_in_use then
    delete from public.box_layers where box_id = p_box_id;
    perform private.persist_box_layers(p_box_id, p_layers);
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'box.updated', 'box', p_box_id::text,
    jsonb_build_object('box_code', normalized_box_code, 'layers_locked', box_in_use)
  );

  return p_box_id;
end;
$$;

create or replace function public.set_box_active(
  p_box_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_code text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'BOX_ADMIN_REQUIRED';
  end if;

  update public.boxes
  set is_active = p_is_active
  where id = p_box_id
  returning box_code into target_code;

  if not found then
    raise exception using errcode = 'P0001', message = 'BOX_NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when p_is_active then 'box.activated' else 'box.deactivated' end,
    'box', p_box_id::text,
    jsonb_build_object('box_code', target_code)
  );
end;
$$;

create or replace function public.delete_box(
  p_box_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_code text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'BOX_ADMIN_REQUIRED';
  end if;

  select box_code into target_code from public.boxes where id = p_box_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'BOX_NOT_FOUND';
  end if;

  begin
    delete from public.boxes where id = p_box_id;
  exception when foreign_key_violation then
    raise exception using errcode = 'P0001', message = 'BOX_IN_USE';
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'box.deleted', 'box', p_box_id::text, jsonb_build_object('box_code', target_code));
end;
$$;

revoke execute on function private.validate_box_layers_payload(jsonb) from public, anon, authenticated;
revoke execute on function private.persist_box_layers(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.create_box(text, text, jsonb) from public, anon;
revoke execute on function public.update_box(uuid, text, text, jsonb) from public, anon;
revoke execute on function public.set_box_active(uuid, boolean) from public, anon;
revoke execute on function public.delete_box(uuid) from public, anon;

grant execute on function public.create_box(text, text, jsonb) to authenticated;
grant execute on function public.update_box(uuid, text, text, jsonb) to authenticated;
grant execute on function public.set_box_active(uuid, boolean) to authenticated;
grant execute on function public.delete_box(uuid) to authenticated;

-- 9. Master Item <> Box assignment RPCs -------------------------------------
-- p_layers shape: [{ "box_layer_id": uuid, "requirements": [{ "product_id",
-- "expected_qty" }] }]. box_layer_id must reference an existing, active
-- layer that belongs to the target box: layers are shape, not created here.

create or replace function private.sync_master_item_product_mappings(
  p_master_item_id uuid,
  p_layers jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  layer_record record;
  requirement_record record;
  product_text text;
  product_id uuid;
begin
  for layer_record in
    select layer.value
    from jsonb_array_elements(p_layers) as layer(value)
  loop
    for requirement_record in
      select requirement.value
      from jsonb_array_elements(layer_record.value -> 'requirements') as requirement(value)
    loop
      product_text := requirement_record.value ->> 'product_id';
      begin
        product_id := product_text::uuid;
      exception when invalid_text_representation then
        continue;
      end;

      if exists (
        select 1 from public.products product
        where product.id = product_id and product.is_active
      ) then
        insert into public.master_item_products (master_item_id, product_id, is_active)
        values (p_master_item_id, product_id, true)
        on conflict (master_item_id, product_id) do update
        set is_active = true
        where not public.master_item_products.is_active;
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function private.validate_master_item_box_payload(
  p_master_item_id uuid,
  p_box_id uuid,
  p_layers jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  layer_record record;
  requirement_record record;
  box_layer_id_text text;
  box_layer_id uuid;
  product_text text;
  parsed_product_id uuid;
  expected_qty_text text;
  expected_qty integer;
  layer_product_ids uuid[];
  seen_box_layer_ids uuid[];
begin
  if p_master_item_id is null
    or not exists (
      select 1 from public.master_items item
      where item.id = p_master_item_id and item.is_active
    ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_MASTER_ITEM_NOT_FOUND';
  end if;

  if p_box_id is null
    or not exists (
      select 1 from public.boxes box where box.id = p_box_id and box.is_active
    ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_BOX_NOT_FOUND';
  end if;

  if coalesce(jsonb_typeof(p_layers), '') <> 'array'
    or jsonb_array_length(p_layers) = 0
    or jsonb_array_length(p_layers) > 10 then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
  end if;

  seen_box_layer_ids := array[]::uuid[];
  for layer_record in
    select layer.value
    from jsonb_array_elements(p_layers) as layer(value)
  loop
    if jsonb_typeof(layer_record.value) <> 'object'
      or jsonb_typeof(layer_record.value -> 'box_layer_id') <> 'string'
      or coalesce(jsonb_typeof(layer_record.value -> 'requirements'), '') <> 'array'
      or jsonb_array_length(layer_record.value -> 'requirements') = 0 then
      raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
    end if;

    box_layer_id_text := layer_record.value ->> 'box_layer_id';
    begin
      box_layer_id := box_layer_id_text::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
    end;

    if box_layer_id = any(seen_box_layer_ids) then
      raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
    end if;
    seen_box_layer_ids := array_append(seen_box_layer_ids, box_layer_id);

    if not exists (
      select 1 from public.box_layers layer
      where layer.id = box_layer_id and layer.box_id = p_box_id and layer.is_active
    ) then
      raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_LAYER_NOT_ALLOWED';
    end if;

    layer_product_ids := array[]::uuid[];
    for requirement_record in
      select requirement.value
      from jsonb_array_elements(layer_record.value -> 'requirements') as requirement(value)
    loop
      if jsonb_typeof(requirement_record.value) <> 'object'
        or jsonb_typeof(requirement_record.value -> 'product_id') <> 'string'
        or jsonb_typeof(requirement_record.value -> 'expected_qty') <> 'number' then
        raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
      end if;

      product_text := requirement_record.value ->> 'product_id';
      expected_qty_text := requirement_record.value ->> 'expected_qty';
      begin
        parsed_product_id := product_text::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
      end;

      if expected_qty_text !~ '^[0-9]+$'
        or char_length(expected_qty_text) > 7 then
        raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
      end if;

      expected_qty := expected_qty_text::integer;
      if expected_qty < 1 or expected_qty > 1000000 then
        raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
      end if;

      if parsed_product_id = any(layer_product_ids) then
        raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
      end if;
      layer_product_ids := array_append(layer_product_ids, parsed_product_id);

      if not exists (
        select 1 from public.products product
        where product.id = parsed_product_id and product.is_active
      ) or not exists (
        select 1 from public.master_item_products mapping
        where mapping.master_item_id = p_master_item_id
          and mapping.product_id = parsed_product_id
          and mapping.is_active
      ) then
        raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_PRODUCT_NOT_ALLOWED';
      end if;
    end loop;
  end loop;
end;
$$;

create or replace function private.persist_master_item_box_requirements(
  p_master_item_box_id uuid,
  p_layers jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  layer_record record;
  requirement_record record;
  target_box_layer_id uuid;
begin
  for layer_record in
    select layer.value
    from jsonb_array_elements(p_layers) as layer(value)
  loop
    target_box_layer_id := (layer_record.value ->> 'box_layer_id')::uuid;

    for requirement_record in
      select requirement.value, requirement.ordinality
      from jsonb_array_elements(layer_record.value -> 'requirements') with ordinality
        as requirement(value, ordinality)
    loop
      insert into public.box_layer_requirements (
        master_item_box_id, box_layer_id, product_id, expected_qty, sort_order
      ) values (
        p_master_item_box_id,
        target_box_layer_id,
        (requirement_record.value ->> 'product_id')::uuid,
        (requirement_record.value ->> 'expected_qty')::integer,
        requirement_record.ordinality::integer
      );
    end loop;
  end loop;
end;
$$;

create or replace function public.create_master_item_box(
  p_master_item_id uuid,
  p_box_id uuid,
  p_layers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_master_item_box_id uuid;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_ADMIN_REQUIRED';
  end if;

  perform private.sync_master_item_product_mappings(p_master_item_id, p_layers);
  perform private.validate_master_item_box_payload(p_master_item_id, p_box_id, p_layers);

  begin
    insert into public.master_item_boxes (master_item_id, box_id, version, is_active)
    values (p_master_item_id, p_box_id, 1, false)
    returning id into target_master_item_box_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_EXISTS';
  end;

  perform private.persist_master_item_box_requirements(target_master_item_box_id, p_layers);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'master_item_box.created', 'master_item_box', target_master_item_box_id::text,
    jsonb_build_object('master_item_id', p_master_item_id, 'box_id', p_box_id, 'version', 1)
  );

  return target_master_item_box_id;
end;
$$;

create or replace function public.save_master_item_box_requirements(
  p_master_item_id uuid,
  p_master_item_box_id uuid,
  p_layers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_assignment public.master_item_boxes%rowtype;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_ADMIN_REQUIRED';
  end if;

  select * into target_assignment
  from public.master_item_boxes assignment
  where assignment.id = p_master_item_box_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_NOT_FOUND';
  end if;

  if target_assignment.master_item_id <> p_master_item_id then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_MISMATCH';
  end if;

  if exists (
    select 1 from public.packing_sessions session
    where session.master_item_box_id = p_master_item_box_id
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_IN_USE';
  end if;

  perform private.sync_master_item_product_mappings(p_master_item_id, p_layers);
  perform private.validate_master_item_box_payload(p_master_item_id, target_assignment.box_id, p_layers);

  delete from public.box_layer_requirements
  where master_item_box_id = p_master_item_box_id;

  perform private.persist_master_item_box_requirements(p_master_item_box_id, p_layers);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'master_item_box.requirements_updated', 'master_item_box', p_master_item_box_id::text,
    jsonb_build_object('master_item_id', p_master_item_id, 'layer_count', jsonb_array_length(p_layers))
  );

  return p_master_item_box_id;
end;
$$;

create or replace function private.validate_master_item_box(
  target_master_item_box_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  errors text[] := array[]::text[];
  target_master_item_id uuid;
  target_box_id uuid;
begin
  select assignment.master_item_id, assignment.box_id
  into target_master_item_id, target_box_id
  from public.master_item_boxes assignment
  join public.master_items item on item.id = assignment.master_item_id
  where assignment.id = target_master_item_box_id and item.is_active;

  if target_master_item_id is null then
    errors := array_append(errors, 'MASTER_ITEM_BOX_OR_ACTIVE_MASTER_ITEM_NOT_FOUND');
  end if;

  if not exists (
    select 1 from public.box_layers layer
    where layer.box_id = target_box_id and layer.is_active
  ) then
    errors := array_append(errors, 'ACTIVE_LAYER_REQUIRED');
  end if;

  if exists (
    select 1 from public.box_layers layer
    where layer.box_id = target_box_id and layer.is_active
      and not exists (
        select 1 from public.box_layer_requirements requirement
        where requirement.box_layer_id = layer.id
          and requirement.master_item_box_id = target_master_item_box_id
      )
  ) then
    errors := array_append(errors, 'LAYER_REQUIREMENT_REQUIRED');
  end if;

  if exists (
    select 1
    from public.box_layer_requirements requirement
    join public.box_layers layer on layer.id = requirement.box_layer_id
    left join public.products product on product.id = requirement.product_id and product.is_active
    left join public.master_item_products mapping
      on mapping.master_item_id = target_master_item_id
      and mapping.product_id = requirement.product_id and mapping.is_active
    where requirement.master_item_box_id = target_master_item_box_id
      and layer.box_id = target_box_id and layer.is_active
      and (product.id is null or mapping.id is null)
  ) then
    errors := array_append(errors, 'PRODUCT_NOT_ACTIVE_OR_ALLOWED');
  end if;

  return jsonb_build_object('valid', cardinality(errors) = 0, 'errors', to_jsonb(errors));
end;
$$;

create or replace function private.activate_master_item_box(
  target_master_item_box_id uuid,
  target_correlation_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  target_assignment public.master_item_boxes%rowtype;
  validation_result jsonb;
begin
  if not private.is_active_admin() then
    raise exception using errcode = '42501', message = 'MASTER_ITEM_BOX_ACTIVATION_NOT_AUTHORIZED';
  end if;

  select * into target_assignment
  from public.master_item_boxes
  where id = target_master_item_box_id for update;

  if not found then
    raise exception using errcode = '22023', message = 'MASTER_ITEM_BOX_NOT_FOUND';
  end if;

  validation_result := private.validate_master_item_box(target_master_item_box_id);
  if not coalesce((validation_result ->> 'valid')::boolean, false) then
    raise exception using errcode = '22023', message = 'MASTER_ITEM_BOX_INVALID', detail = validation_result::text;
  end if;

  update public.master_item_boxes set is_active = false
  where master_item_id = target_assignment.master_item_id
    and box_id = target_assignment.box_id
    and id <> target_master_item_box_id and is_active;
  update public.master_item_boxes set is_active = true where id = target_master_item_box_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata, correlation_id)
  values (
    auth.uid(), 'master_item_box.activated', 'master_item_box', target_master_item_box_id::text,
    jsonb_build_object('master_item_id', target_assignment.master_item_id, 'box_id', target_assignment.box_id, 'version', target_assignment.version),
    target_correlation_id
  );

  return target_master_item_box_id;
end;
$$;

create or replace function public.publish_master_item_box(
  p_master_item_box_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_ADMIN_REQUIRED';
  end if;

  return private.activate_master_item_box(p_master_item_box_id, gen_random_uuid());
end;
$$;

create or replace function public.clone_master_item_box_version(
  p_master_item_box_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  source_assignment public.master_item_boxes%rowtype;
  source_requirement record;
  target_master_item_box_id uuid;
  target_version integer;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_ADMIN_REQUIRED';
  end if;

  select * into source_assignment
  from public.master_item_boxes
  where id = p_master_item_box_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_NOT_FOUND';
  end if;

  -- All versions of a master-item/box family contend on this
  -- transaction-scoped key before any row locks are acquired, preventing
  -- sibling clones from taking source/family row locks in inverse order.
  perform pg_advisory_xact_lock(
    hashtextextended(
      source_assignment.master_item_id::text || ':' || source_assignment.box_id::text,
      0
    )
  );

  perform 1
  from public.master_item_boxes assignment
  where assignment.master_item_id = source_assignment.master_item_id
    and assignment.box_id = source_assignment.box_id
  order by assignment.id
  for update;

  select coalesce(max(assignment.version), 0) + 1 into target_version
  from public.master_item_boxes assignment
  where assignment.master_item_id = source_assignment.master_item_id
    and assignment.box_id = source_assignment.box_id;

  insert into public.master_item_boxes (master_item_id, box_id, version, is_active)
  values (source_assignment.master_item_id, source_assignment.box_id, target_version, false)
  returning id into target_master_item_box_id;

  for source_requirement in
    select requirement.box_layer_id, requirement.product_id, requirement.expected_qty, requirement.sort_order
    from public.box_layer_requirements requirement
    where requirement.master_item_box_id = source_assignment.id
    order by requirement.box_layer_id, requirement.sort_order
  loop
    insert into public.box_layer_requirements (
      master_item_box_id, box_layer_id, product_id, expected_qty, sort_order
    ) values (
      target_master_item_box_id,
      source_requirement.box_layer_id,
      source_requirement.product_id,
      source_requirement.expected_qty,
      source_requirement.sort_order
    );
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'master_item_box.cloned', 'master_item_box', target_master_item_box_id::text,
    jsonb_build_object(
      'master_item_id', source_assignment.master_item_id,
      'box_id', source_assignment.box_id,
      'version', target_version,
      'source_master_item_box_id', source_assignment.id
    )
  );

  return target_master_item_box_id;
end;
$$;

revoke execute on function private.sync_master_item_product_mappings(uuid, jsonb) from public, anon, authenticated;
revoke execute on function private.validate_master_item_box_payload(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function private.persist_master_item_box_requirements(uuid, jsonb) from public, anon, authenticated;
revoke execute on function private.validate_master_item_box(uuid) from public, anon, authenticated;
revoke execute on function private.activate_master_item_box(uuid, uuid) from public, anon;

revoke execute on function public.create_master_item_box(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.save_master_item_box_requirements(uuid, uuid, jsonb) from public, anon;
revoke execute on function public.publish_master_item_box(uuid) from public, anon;
revoke execute on function public.clone_master_item_box_version(uuid) from public, anon;

grant execute on function public.create_master_item_box(uuid, uuid, jsonb) to authenticated;
grant execute on function public.save_master_item_box_requirements(uuid, uuid, jsonb) to authenticated;
grant execute on function public.publish_master_item_box(uuid) to authenticated;
grant execute on function public.clone_master_item_box_version(uuid) to authenticated;
