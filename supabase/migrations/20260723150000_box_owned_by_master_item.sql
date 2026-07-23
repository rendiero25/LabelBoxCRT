-- Box stops being shared master data (boxes + master_item_boxes
-- version/publish join). Each Master Item now owns up to 3 Box slots
-- directly: Box 1 / Box 2 / Box 3, auto-named/auto-coded, with nested
-- Layers and per-layer product requirements, no versioning. Also drops
-- master_items.item_sequence_code, and loosens Delivery Number RPCs to
-- operators (Delivery Number CRUD moves from its own admin page into the
-- Scan page). See
-- docs/superpowers/specs/2026-07-23-box-restructure-master-item-design.md.
--
-- Dev-stage data reset (approved): existing box/master_item_box rows and
-- everything that FKs to them are truncated rather than migrated.

-- 1. Drop RLS policies that reference columns/tables being removed -------

drop policy boxes_select on public.boxes;
drop policy box_layers_select on public.box_layers;
drop policy box_layer_requirements_select on public.box_layer_requirements;

-- 2. Drop RPCs tied to the old shape --------------------------------------

drop function if exists public.create_master_item_box(uuid, uuid, jsonb);
drop function if exists public.save_master_item_box_requirements(uuid, uuid, jsonb);
drop function if exists public.publish_master_item_box(uuid);
drop function if exists public.clone_master_item_box_version(uuid);
drop function if exists private.validate_master_item_box_payload(uuid, uuid, jsonb);
drop function if exists private.persist_master_item_box_requirements(uuid, jsonb);
drop function if exists private.validate_master_item_box(uuid);
drop function if exists private.activate_master_item_box(uuid, uuid);
drop function if exists private.sync_master_item_product_mappings(uuid, jsonb);
drop function if exists public.create_box(text, jsonb);
drop function if exists public.update_box(uuid, text, jsonb);
drop function if exists public.set_box_active(uuid, boolean);
drop function if exists public.delete_box(uuid);
drop function if exists private.validate_box_layers_payload(jsonb);
drop function if exists private.persist_box_layers(uuid, jsonb);
drop function if exists public.start_packing_session(uuid, uuid);
drop function if exists public.create_master_item(text, text, text, integer, text, text);
drop function if exists public.update_master_item(uuid, text, text, text, integer, text);

-- 3. Reset dependent data --------------------------------------------------

truncate table
  public.reprint_requests,
  public.print_attempts,
  public.print_jobs,
  public.packing_session_scans,
  public.packing_sessions
cascade;

truncate table public.box_layer_requirements, public.box_layers, public.boxes cascade;

-- cascade also drops box_layer_requirements_master_item_box_id_fkey, which
-- references this table (step 6 below finishes reshaping that column).
drop table public.master_item_boxes cascade;

-- 4. Reshape boxes: owned by one Master Item, slot 1-3, no is_active ------
-- boxes is empty after the truncate above, so the new columns can go
-- straight to not null without a backfill step.

alter table public.boxes
  add column master_item_id uuid references public.master_items (id) on delete restrict,
  add column box_no integer check (box_no between 1 and 3);

alter table public.boxes
  alter column master_item_id set not null,
  alter column box_no set not null,
  drop column is_active;

alter table public.boxes
  add constraint boxes_master_item_box_no_key unique (master_item_id, box_no);

-- 5. Reshape box_layers: drop is_active ------------------------------------

alter table public.box_layers drop column is_active;

-- 6. Reshape box_layer_requirements: drop master_item_box_id ---------------
-- (its FK constraint was already dropped by the `cascade` in step 3 above)

alter table public.box_layer_requirements
  drop constraint box_layer_requirements_assignment_layer_product_key,
  drop constraint box_layer_requirements_assignment_layer_sort_key,
  drop column master_item_box_id;

alter table public.box_layer_requirements
  add constraint box_layer_requirements_layer_product_key unique (box_layer_id, product_id),
  add constraint box_layer_requirements_layer_sort_key unique (box_layer_id, sort_order);

-- 7. Repoint packing_sessions: master_item_box_id -> box_id, drop version -

alter table public.packing_sessions rename column master_item_box_id to box_id;
alter table public.packing_sessions
  add constraint packing_sessions_box_id_fkey
  foreign key (box_id) references public.boxes (id) on delete restrict;
alter index public.packing_sessions_master_item_box_idx rename to packing_sessions_box_idx;
alter table public.packing_sessions drop column version;

-- 8. Drop master_items.item_sequence_code ----------------------------------

alter table public.master_items drop column item_sequence_code;

-- 9. RLS: select policies for the new shape --------------------------------

create policy boxes_select on public.boxes for select to authenticated
using (
  (select private.is_active_admin())
  or ((select private.is_active_operator()) and exists (
    select 1 from public.master_items item
    where item.id = boxes.master_item_id and item.is_active
  ))
);

create policy box_layers_select on public.box_layers for select to authenticated
using (
  (select private.is_active_admin())
  or ((select private.is_active_operator()) and exists (
    select 1 from public.boxes box
    join public.master_items item on item.id = box.master_item_id
    where box.id = box_layers.box_id and item.is_active
  ))
);

create policy box_layer_requirements_select on public.box_layer_requirements for select to authenticated
using (
  (select private.is_active_admin())
  or ((select private.is_active_operator()) and exists (
    select 1
    from public.box_layers layer
    join public.boxes box on box.id = layer.box_id
    join public.master_items item on item.id = box.master_item_id
    join public.products product on product.id = box_layer_requirements.product_id
    join public.master_item_products mapping
      on mapping.master_item_id = box.master_item_id
      and mapping.product_id = box_layer_requirements.product_id
    where layer.id = box_layer_requirements.box_layer_id
      and item.is_active and product.is_active and mapping.is_active
  ))
);

-- 10. Box/Layer/Requirement RPCs (admin only, same as Master Item mgmt) ---

create or replace function private.sync_master_item_product_mapping(
  p_master_item_id uuid,
  p_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if exists (
    select 1 from public.products product
    where product.id = p_product_id and product.is_active
  ) then
    insert into public.master_item_products (master_item_id, product_id, is_active)
    values (p_master_item_id, p_product_id, true)
    on conflict (master_item_id, product_id) do update
    set is_active = true
    where not public.master_item_products.is_active;
  end if;
end;
$$;

create or replace function public.create_master_item_box(
  p_master_item_id uuid
)
returns table (
  id uuid,
  master_item_id uuid,
  box_no integer,
  box_code text,
  box_name text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_slot integer;
  generated_box_code text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_ADMIN_REQUIRED';
  end if;

  if not exists (
    select 1 from public.master_items item
    where item.id = p_master_item_id and item.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_MASTER_ITEM_NOT_FOUND';
  end if;

  select min(slot) into target_slot
  from generate_series(1, 3) as slot
  where slot not in (
    select box.box_no from public.boxes box where box.master_item_id = p_master_item_id
  );

  if target_slot is null then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_LIMIT_REACHED';
  end if;

  generated_box_code := 'box-' || lpad(nextval('public.box_code_seq')::text, 2, '0');

  insert into public.boxes (master_item_id, box_no, box_code, box_name)
  values (p_master_item_id, target_slot, generated_box_code, 'Box ' || target_slot)
  returning boxes.id, boxes.master_item_id, boxes.box_no, boxes.box_code, boxes.box_name
  into id, master_item_id, box_no, box_code, box_name;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'master_item_box.created', 'box', id::text,
    jsonb_build_object('master_item_id', master_item_id, 'box_no', box_no, 'box_code', box_code)
  );

  return next;
end;
$$;

create or replace function public.delete_master_item_box(
  p_box_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_box public.boxes%rowtype;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_ADMIN_REQUIRED';
  end if;

  select * into target_box from public.boxes where id = p_box_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_NOT_FOUND';
  end if;

  if exists (select 1 from public.packing_sessions session where session.box_id = p_box_id) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_IN_USE';
  end if;

  delete from public.box_layer_requirements
  where box_layer_id in (select id from public.box_layers where box_id = p_box_id);
  delete from public.box_layers where box_id = p_box_id;
  delete from public.boxes where id = p_box_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'master_item_box.deleted', 'box', p_box_id::text,
    jsonb_build_object('master_item_id', target_box.master_item_id, 'box_no', target_box.box_no)
  );
end;
$$;

create or replace function public.create_box_layer(
  p_box_id uuid
)
returns table (
  id uuid,
  box_id uuid,
  layer_no integer,
  layer_name text,
  sort_order integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_box public.boxes%rowtype;
  next_layer_no integer;
  generated_layer_name text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_ADMIN_REQUIRED';
  end if;

  select * into target_box from public.boxes box where box.id = p_box_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_NOT_FOUND';
  end if;

  if exists (select 1 from public.packing_sessions session where session.box_id = p_box_id) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_IN_USE';
  end if;

  select count(*) into next_layer_no from public.box_layers layer where layer.box_id = p_box_id;
  if next_layer_no >= 10 then
    raise exception using errcode = 'P0001', message = 'BOX_LAYER_LIMIT_REACHED';
  end if;
  next_layer_no := next_layer_no + 1;
  generated_layer_name := 'Box ' || target_box.box_no || ' - Layer ' || next_layer_no;

  insert into public.box_layers (box_id, layer_no, layer_name, sort_order)
  values (p_box_id, next_layer_no, generated_layer_name, next_layer_no)
  returning box_layers.id, box_layers.box_id, box_layers.layer_no, box_layers.layer_name, box_layers.sort_order
  into id, box_id, layer_no, layer_name, sort_order;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'box_layer.created', 'box_layer', id::text,
    jsonb_build_object('box_id', box_id, 'layer_no', layer_no)
  );

  return next;
end;
$$;

create or replace function public.delete_box_layer(
  p_box_layer_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_layer public.box_layers%rowtype;
  highest_layer_no integer;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_ADMIN_REQUIRED';
  end if;

  select * into target_layer from public.box_layers where id = p_box_layer_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'BOX_LAYER_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.packing_sessions session where session.box_id = target_layer.box_id
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_IN_USE';
  end if;

  select max(layer_no) into highest_layer_no
  from public.box_layers layer where layer.box_id = target_layer.box_id;

  if target_layer.layer_no <> highest_layer_no then
    raise exception using errcode = 'P0001', message = 'BOX_LAYER_NOT_LAST';
  end if;

  delete from public.box_layer_requirements where box_layer_id = p_box_layer_id;
  delete from public.box_layers where id = p_box_layer_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'box_layer.deleted', 'box_layer', p_box_layer_id::text,
    jsonb_build_object('box_id', target_layer.box_id, 'layer_no', target_layer.layer_no)
  );
end;
$$;

create or replace function public.save_box_layer_requirements(
  p_box_layer_id uuid,
  p_requirements jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_layer public.box_layers%rowtype;
  target_box public.boxes%rowtype;
  requirement_record record;
  product_text text;
  parsed_product_id uuid;
  expected_qty_text text;
  expected_qty integer;
  seen_product_ids uuid[] := array[]::uuid[];
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_ADMIN_REQUIRED';
  end if;

  select * into target_layer from public.box_layers where id = p_box_layer_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'BOX_LAYER_NOT_FOUND';
  end if;

  select * into target_box from public.boxes where id = target_layer.box_id;

  if exists (
    select 1 from public.packing_sessions session where session.box_id = target_box.id
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_IN_USE';
  end if;

  if coalesce(jsonb_typeof(p_requirements), '') <> 'array'
    or jsonb_array_length(p_requirements) = 0 then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
  end if;

  for requirement_record in
    select value from jsonb_array_elements(p_requirements) as elem(value)
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

    if expected_qty_text !~ '^[0-9]+$' or char_length(expected_qty_text) > 7 then
      raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
    end if;
    expected_qty := expected_qty_text::integer;
    if expected_qty < 1 or expected_qty > 1000000 then
      raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
    end if;

    if parsed_product_id = any(seen_product_ids) then
      raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_INPUT_INVALID';
    end if;
    seen_product_ids := array_append(seen_product_ids, parsed_product_id);

    perform private.sync_master_item_product_mapping(target_box.master_item_id, parsed_product_id);

    if not exists (
      select 1 from public.products product
      where product.id = parsed_product_id and product.is_active
    ) or not exists (
      select 1 from public.master_item_products mapping
      where mapping.master_item_id = target_box.master_item_id
        and mapping.product_id = parsed_product_id
        and mapping.is_active
    ) then
      raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_PRODUCT_NOT_ALLOWED';
    end if;
  end loop;

  delete from public.box_layer_requirements where box_layer_id = p_box_layer_id;

  insert into public.box_layer_requirements (box_layer_id, product_id, expected_qty, sort_order)
  select
    p_box_layer_id,
    (elem.value ->> 'product_id')::uuid,
    (elem.value ->> 'expected_qty')::integer,
    elem.ordinality::integer
  from jsonb_array_elements(p_requirements) with ordinality as elem(value, ordinality);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'box_layer.requirements_saved', 'box_layer', p_box_layer_id::text,
    jsonb_build_object('box_id', target_box.id, 'requirement_count', jsonb_array_length(p_requirements))
  );
end;
$$;

revoke execute on function private.sync_master_item_product_mapping(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.create_master_item_box(uuid) from public, anon;
revoke execute on function public.delete_master_item_box(uuid) from public, anon;
revoke execute on function public.create_box_layer(uuid) from public, anon;
revoke execute on function public.delete_box_layer(uuid) from public, anon;
revoke execute on function public.save_box_layer_requirements(uuid, jsonb) from public, anon;

grant execute on function public.create_master_item_box(uuid) to authenticated;
grant execute on function public.delete_master_item_box(uuid) to authenticated;
grant execute on function public.create_box_layer(uuid) to authenticated;
grant execute on function public.delete_box_layer(uuid) to authenticated;
grant execute on function public.save_box_layer_requirements(uuid, jsonb) to authenticated;

-- 11. Master Item RPCs: drop item_sequence_code ----------------------------

create function public.create_master_item(
  p_part_no text,
  p_part_name text,
  p_unit text,
  p_default_label_qty integer,
  p_item_code text default null
)
returns table (
  id uuid,
  item_code text,
  part_no text,
  part_name text,
  unit text,
  default_label_qty integer,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_item_code text := nullif(lower(btrim(coalesce(p_item_code, ''))), '');
  normalized_part_no text := upper(btrim(p_part_no));
  normalized_part_name text := btrim(p_part_name);
  normalized_unit text := initcap(lower(btrim(p_unit)));
  candidate_code text;
  violated_constraint text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  if (normalized_item_code is not null and normalized_item_code !~ '^[a-z0-9][a-z0-9_-]{1,63}$')
    or normalized_part_no !~ '^[A-Z0-9][A-Z0-9_./-]{1,127}$'
    or normalized_part_name = ''
    or char_length(normalized_part_name) > 200
    or normalized_unit !~ '^[A-Za-z][A-Za-z ./-]{0,31}$'
    or p_default_label_qty is null or p_default_label_qty < 1 or p_default_label_qty > 1000000 then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_INPUT_INVALID';
  end if;

  if normalized_item_code is null then
    loop
      candidate_code := 'mstritem-' || lpad(nextval('public.master_item_code_seq')::text, 2, '0');

      begin
        insert into public.master_items (item_code, part_no, part_name, unit, default_label_qty)
        values (candidate_code, normalized_part_no, normalized_part_name, normalized_unit, p_default_label_qty)
        returning * into id, item_code, part_no, part_name, unit, default_label_qty,
          is_active, created_at, updated_at;
        exit;
      exception when unique_violation then
        get stacked diagnostics violated_constraint = constraint_name;
        if violated_constraint <> 'master_items_item_code_key' then
          raise exception using errcode = 'P0001', message = 'MASTER_ITEM_PART_NO_EXISTS';
        end if;
      end;
    end loop;
  else
    begin
      insert into public.master_items (item_code, part_no, part_name, unit, default_label_qty)
      values (normalized_item_code, normalized_part_no, normalized_part_name, normalized_unit, p_default_label_qty)
      returning * into id, item_code, part_no, part_name, unit, default_label_qty,
        is_active, created_at, updated_at;
    exception when unique_violation then
      get stacked diagnostics violated_constraint = constraint_name;
      raise exception using errcode = 'P0001', message = case
        when violated_constraint = 'master_items_item_code_key' then 'MASTER_ITEM_CODE_EXISTS'
        else 'MASTER_ITEM_PART_NO_EXISTS'
      end;
    end;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'master_item.created', 'master_item', id::text,
    jsonb_build_object('item_code', item_code, 'part_no', part_no, 'default_label_qty', default_label_qty)
  );

  return next;
end;
$$;

create function public.update_master_item(
  p_master_item_id uuid,
  p_part_no text,
  p_part_name text,
  p_unit text,
  p_default_label_qty integer
)
returns table (
  id uuid,
  item_code text,
  part_no text,
  part_name text,
  unit text,
  default_label_qty integer,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_part_no text := upper(btrim(p_part_no));
  normalized_part_name text := btrim(p_part_name);
  normalized_unit text := initcap(lower(btrim(p_unit)));
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  if normalized_part_no !~ '^[A-Z0-9][A-Z0-9_./-]{1,127}$'
    or normalized_part_name = ''
    or char_length(normalized_part_name) > 200
    or normalized_unit !~ '^[A-Za-z][A-Za-z ./-]{0,31}$'
    or p_default_label_qty is null or p_default_label_qty < 1 or p_default_label_qty > 1000000 then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_INPUT_INVALID';
  end if;

  if exists (select 1 from public.packing_sessions where master_item_id = p_master_item_id) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_IN_USE';
  end if;

  begin
    update public.master_items
    set part_no = normalized_part_no,
        part_name = normalized_part_name,
        unit = normalized_unit,
        default_label_qty = p_default_label_qty
    where public.master_items.id = p_master_item_id
    returning * into id, item_code, part_no, part_name, unit, default_label_qty,
      is_active, created_at, updated_at;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_PART_NO_EXISTS';
  end;

  if not found then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'master_item.updated', 'master_item', id::text,
    jsonb_build_object('item_code', item_code, 'part_no', part_no, 'default_label_qty', default_label_qty)
  );

  return next;
end;
$$;

revoke execute on function public.create_master_item(text, text, text, integer, text) from public, anon;
revoke execute on function public.update_master_item(uuid, text, text, text, integer) from public, anon;
grant execute on function public.create_master_item(text, text, text, integer, text) to authenticated;
grant execute on function public.update_master_item(uuid, text, text, text, integer) to authenticated;

-- 12. CSV import: drop item_sequence_code from master_item template -------

create or replace function public.preview_csv_import(
  p_template text,
  p_rows jsonb
)
returns table (
  row_number integer,
  errors text[]
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_template text := lower(btrim(p_template));
  v_row jsonb;
  v_index bigint;
  v_source_line text;
  v_supplier_code text;
  v_supplier_name text;
  v_part_name text;
  v_outer_diameter text;
  v_inner_diameter text;
  v_length text;
  v_item_code text;
  v_part_no text;
  v_unit text;
  v_label_qty text;
  v_product_code text;
  v_delivery_number text;
  v_delivery_date text;
  v_delivery_status text;
  v_parsed_date date;
  v_seen_keys text[] := array[]::text[];
  v_key text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_ADMIN_REQUIRED';
  end if;

  if v_template not in (
    'supplier', 'product', 'master_item', 'product_mapping', 'delivery_number'
  ) then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_TEMPLATE_INVALID';
  end if;

  if jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) = 0
    or jsonb_array_length(p_rows) > 500 then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_INPUT_INVALID';
  end if;

  for v_row, v_index in
    select source.value, source.ordinality
    from jsonb_array_elements(p_rows) with ordinality as source(value, ordinality)
  loop
    row_number := v_index::integer + 1;
    errors := array[]::text[];

    if jsonb_typeof(v_row) <> 'object' then
      errors := array_append(errors, 'Baris CSV tidak valid.');
      return next;
      continue;
    end if;

    v_source_line := private.csv_import_value(v_row, 'line');
    begin
      if v_source_line !~ '^[2-9][0-9]*$' then
        raise exception 'invalid source line';
      end if;
      row_number := v_source_line::integer;
    exception when others then
      errors := array_append(errors, 'Nomor baris CSV tidak valid.');
    end;

    if v_template = 'supplier' then
      v_supplier_code := upper(private.csv_import_value(v_row, 'supplier_code'));
      v_supplier_name := private.csv_import_value(v_row, 'supplier_name');
      if v_supplier_code !~ '^[A-Z0-9_-]{2,64}$' then
        errors := array_append(errors, 'Kode supplier tidak valid.');
      end if;
      if v_supplier_name = '' or char_length(v_supplier_name) > 200 then
        errors := array_append(errors, 'Nama supplier tidak valid.');
      end if;
      v_key := 'supplier:' || lower(v_supplier_code);
      if v_key = any(v_seen_keys) then
        errors := array_append(errors, 'Kode supplier duplikat di CSV.');
      else
        v_seen_keys := array_append(v_seen_keys, v_key);
      end if;
      if exists (
        select 1 from public.suppliers as s
        where lower(btrim(s.supplier_code)) = lower(v_supplier_code)
      ) then
        errors := array_append(errors, 'Kode supplier sudah digunakan.');
      end if;

    elsif v_template = 'product' then
      v_part_name := private.csv_import_value(v_row, 'part_name');
      v_outer_diameter := private.csv_import_value(v_row, 'outer_diameter');
      v_inner_diameter := private.csv_import_value(v_row, 'inner_diameter');
      v_length := private.csv_import_value(v_row, 'length');
      if v_part_name = '' or char_length(v_part_name) > 200 then
        errors := array_append(errors, 'Nama part tidak valid.');
      end if;
      if v_outer_diameter !~ '^[0-9]+(\.[0-9]+)?$'
        or v_outer_diameter::numeric <= 0 or v_outer_diameter::numeric > 1000000 then
        errors := array_append(errors, 'Diameter luar harus lebih besar dari 0.');
      end if;
      if v_inner_diameter !~ '^[0-9]+(\.[0-9]+)?$'
        or v_inner_diameter::numeric <= 0 or v_inner_diameter::numeric > 1000000 then
        errors := array_append(errors, 'Diameter dalam harus lebih besar dari 0.');
      end if;
      if v_length !~ '^[0-9]+(\.[0-9]+)?$'
        or v_length::numeric <= 0 or v_length::numeric > 1000000 then
        errors := array_append(errors, 'Panjang harus lebih besar dari 0.');
      end if;

    elsif v_template = 'master_item' then
      v_item_code := lower(private.csv_import_value(v_row, 'item_code'));
      v_part_no := upper(private.csv_import_value(v_row, 'part_no'));
      v_part_name := private.csv_import_value(v_row, 'part_name');
      v_unit := initcap(lower(private.csv_import_value(v_row, 'unit')));
      v_label_qty := private.csv_import_value(v_row, 'default_label_qty');
      if v_item_code !~ '^[a-z0-9][a-z0-9_-]{1,63}$' then
        errors := array_append(errors, 'Kode item tidak valid.');
      end if;
      if v_part_no !~ '^[A-Z0-9][A-Z0-9_./-]{1,127}$' then
        errors := array_append(errors, 'Part No tidak valid.');
      end if;
      if v_part_name = '' or char_length(v_part_name) > 200 then
        errors := array_append(errors, 'Nama part tidak valid.');
      end if;
      if v_unit !~ '^[A-Za-z][A-Za-z ./-]{0,31}$' then
        errors := array_append(errors, 'Unit tidak valid.');
      end if;
      if v_label_qty !~ '^[1-9][0-9]{0,5}$' then
        errors := array_append(errors, 'Packing Qty tidak valid.');
      end if;
      v_key := 'master-item-code:' || v_item_code;
      if v_key = any(v_seen_keys) then
        errors := array_append(errors, 'Kode item duplikat di CSV.');
      else
        v_seen_keys := array_append(v_seen_keys, v_key);
      end if;
      v_key := 'master-item-part:' || v_part_no;
      if v_key = any(v_seen_keys) then
        errors := array_append(errors, 'Part No duplikat di CSV.');
      else
        v_seen_keys := array_append(v_seen_keys, v_key);
      end if;
      if exists (
        select 1 from public.master_items as m
        where lower(btrim(m.item_code)) = v_item_code
      ) then
        errors := array_append(errors, 'Kode item sudah digunakan.');
      end if;
      if exists (
        select 1 from public.master_items as m
        where upper(btrim(m.part_no)) = v_part_no
      ) then
        errors := array_append(errors, 'Part No sudah digunakan.');
      end if;

    elsif v_template = 'product_mapping' then
      v_item_code := lower(private.csv_import_value(v_row, 'item_code'));
      v_product_code := lower(private.csv_import_value(v_row, 'product_code'));
      if v_item_code = '' then
        errors := array_append(errors, 'Kode item wajib diisi.');
      end if;
      if v_product_code = '' then
        errors := array_append(errors, 'Kode produk wajib diisi.');
      end if;
      v_key := 'product-mapping:' || v_item_code || ':' || v_product_code;
      if v_key = any(v_seen_keys) then
        errors := array_append(errors, 'Product Mapping duplikat di CSV.');
      else
        v_seen_keys := array_append(v_seen_keys, v_key);
      end if;
      if not exists (
        select 1 from public.master_items as m
        where lower(btrim(m.item_code)) = v_item_code and m.is_active
      ) then
        errors := array_append(errors, 'Master Item aktif tidak ditemukan.');
      end if;
      if not exists (
        select 1 from public.products as p
        where lower(btrim(p.product_code)) = v_product_code and p.is_active
      ) then
        errors := array_append(errors, 'Produk aktif tidak ditemukan.');
      end if;
      if exists (
        select 1
        from public.master_item_products as mp
        join public.master_items as m on m.id = mp.master_item_id
        join public.products as p on p.id = mp.product_id
        where lower(btrim(m.item_code)) = v_item_code
          and lower(btrim(p.product_code)) = v_product_code
      ) then
        errors := array_append(errors, 'Product Mapping sudah terdaftar.');
      end if;

    else
      v_supplier_code := upper(private.csv_import_value(v_row, 'supplier_code'));
      v_delivery_number := upper(private.csv_import_value(v_row, 'delivery_number'));
      v_delivery_date := private.csv_import_value(v_row, 'delivery_date');
      v_delivery_status := lower(private.csv_import_value(v_row, 'status'));
      if v_supplier_code !~ '^[A-Z0-9_-]{2,64}$' then
        errors := array_append(errors, 'Kode supplier tidak valid.');
      end if;
      if v_delivery_number !~ '^[A-Z0-9][A-Z0-9_/-]{1,99}$' then
        errors := array_append(errors, 'Delivery Number tidak valid.');
      end if;
      if v_delivery_status not in ('draft', 'active') then
        errors := array_append(errors, 'Status awal harus draft atau active.');
      end if;
      begin
        if v_delivery_date !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'invalid date';
        end if;
        v_parsed_date := v_delivery_date::date;
        if v_parsed_date::text <> v_delivery_date then
          raise exception 'invalid date';
        end if;
      exception when others then
        errors := array_append(errors, 'Tanggal delivery tidak valid.');
      end;
      v_key := 'delivery-number:' || lower(v_supplier_code) || ':' || lower(v_delivery_number);
      if v_key = any(v_seen_keys) then
        errors := array_append(errors, 'Delivery Number duplikat di CSV.');
      else
        v_seen_keys := array_append(v_seen_keys, v_key);
      end if;
      if not exists (
        select 1 from public.suppliers as s
        where lower(btrim(s.supplier_code)) = lower(v_supplier_code) and s.is_active
      ) then
        errors := array_append(errors, 'Supplier aktif tidak ditemukan.');
      end if;
      if exists (
        select 1
        from public.delivery_numbers as d
        join public.suppliers as s on s.id = d.supplier_id
        where lower(btrim(s.supplier_code)) = lower(v_supplier_code)
          and lower(btrim(d.delivery_number)) = lower(v_delivery_number)
      ) then
        errors := array_append(errors, 'Delivery Number sudah digunakan untuk supplier ini.');
      end if;
    end if;

    return next;
  end loop;
end;
$$;

create or replace function public.import_csv_master_data(
  p_template text,
  p_rows jsonb,
  p_correlation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_template text := lower(btrim(p_template));
  preview_row record;
  row_data jsonb;
  supplier_id uuid;
  master_item_id uuid;
  product_id uuid;
  imported_count integer := 0;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_ADMIN_REQUIRED';
  end if;

  if p_correlation_id is null then
    raise exception using errcode = 'P0001', message = 'CSV_IMPORT_INPUT_INVALID';
  end if;

  for preview_row in
    select * from public.preview_csv_import(normalized_template, p_rows)
  loop
    if cardinality(preview_row.errors) > 0 then
      raise exception using errcode = 'P0001', message = 'CSV_IMPORT_PREVIEW_INVALID';
    end if;
  end loop;

  for row_data in select value from jsonb_array_elements(p_rows)
  loop
    if normalized_template = 'supplier' then
      perform public.create_supplier(
        private.csv_import_value(row_data, 'supplier_code'),
        private.csv_import_value(row_data, 'supplier_name')
      );
    elsif normalized_template = 'product' then
      perform public.create_product(
        private.csv_import_value(row_data, 'part_name'),
        private.csv_import_value(row_data, 'outer_diameter')::numeric,
        private.csv_import_value(row_data, 'inner_diameter')::numeric,
        private.csv_import_value(row_data, 'length')::numeric
      );
    elsif normalized_template = 'master_item' then
      perform public.create_master_item(
        p_part_no => private.csv_import_value(row_data, 'part_no'),
        p_part_name => private.csv_import_value(row_data, 'part_name'),
        p_unit => private.csv_import_value(row_data, 'unit'),
        p_default_label_qty => private.csv_import_value(row_data, 'default_label_qty')::integer,
        p_item_code => private.csv_import_value(row_data, 'item_code')
      );
    elsif normalized_template = 'product_mapping' then
      select id into master_item_id
      from public.master_items
      where lower(btrim(item_code)) = lower(private.csv_import_value(row_data, 'item_code'))
        and is_active;

      select id into product_id
      from public.products
      where lower(btrim(product_code)) = lower(private.csv_import_value(row_data, 'product_code'))
        and is_active;

      perform public.create_master_item_product_mapping(master_item_id, product_id);
    else
      select id into supplier_id
      from public.suppliers
      where lower(btrim(supplier_code)) = lower(private.csv_import_value(row_data, 'supplier_code'))
        and is_active;

      perform public.create_delivery_number(
        supplier_id,
        private.csv_import_value(row_data, 'delivery_number'),
        private.csv_import_value(row_data, 'delivery_date')::date,
        private.csv_import_value(row_data, 'status')::public.delivery_status
      );
    end if;

    imported_count := imported_count + 1;
  end loop;

  insert into public.audit_logs (
    actor_id, action, entity_type, entity_id, metadata, correlation_id
  ) values (
    auth.uid(), 'csv_import.completed', 'csv_import', normalized_template,
    jsonb_build_object('template', normalized_template, 'row_count', imported_count),
    p_correlation_id
  );

  return imported_count;
end;
$$;

-- 13. Repoint packing/scan/finalize RPCs to box_id, drop version ----------

create function public.start_packing_session(
  p_master_item_id uuid,
  p_box_id uuid
)
returns table (
  session_id uuid,
  status public.packing_session_status,
  operator_id uuid,
  master_item_id uuid,
  box_id uuid,
  total_expected_qty integer,
  accepted_qty integer,
  started_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_box public.boxes%rowtype;
  created_session public.packing_sessions%rowtype;
  expected_total integer;
begin
  if not private.is_active_operator() then
    raise exception using errcode = 'P0001', message = 'PACKING_SESSION_OPERATOR_REQUIRED';
  end if;

  if not exists (
    select 1 from public.master_items item
    where item.id = p_master_item_id and item.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_ACTIVE';
  end if;

  select * into target_box
  from public.boxes box
  where box.id = p_box_id and box.master_item_id = p_master_item_id;

  if target_box.id is null then
    raise exception using errcode = 'P0001', message = 'BOX_NOT_FOUND_OR_MISMATCH';
  end if;

  select coalesce(sum(requirement.expected_qty), 0)::integer into expected_total
  from public.box_layer_requirements requirement
  join public.box_layers layer on layer.id = requirement.box_layer_id
  where layer.box_id = p_box_id;

  if expected_total <= 0 then
    raise exception using errcode = 'P0001', message = 'BOX_EMPTY';
  end if;

  insert into public.packing_sessions (operator_id, master_item_id, box_id, status)
  values (auth.uid(), p_master_item_id, p_box_id, 'scanning')
  returning * into created_session;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'packing_session.started', 'packing_session', created_session.id::text,
    jsonb_build_object(
      'master_item_id', created_session.master_item_id,
      'box_id', created_session.box_id,
      'total_expected_qty', expected_total
    )
  );

  return query
  select
    created_session.id, created_session.status, created_session.operator_id,
    created_session.master_item_id, created_session.box_id,
    expected_total, 0, created_session.started_at;
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
  where layer.box_id = target_session.box_id;

  if expected_total <= 0 then
    raise exception using errcode = 'P0001', message = 'SESSION_BOX_INVALID';
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
    select 1 from public.packing_session_scans scan
    where scan.label_uid = normalized_label_uid and scan.result = 'accepted'
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
        requirement.box_layer_id, requirement.expected_qty, count(scan.id)::integer
      into
        selected_box_layer_id, selected_layer_expected_qty, selected_layer_accepted_qty
      from public.box_layer_requirements requirement
      join public.box_layers layer on layer.id = requirement.box_layer_id
      left join public.packing_session_scans scan
        on scan.packing_session_id = target_session.id
        and scan.box_layer_id = requirement.box_layer_id
        and scan.result = 'accepted'
      where layer.box_id = target_session.box_id
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
        join public.box_layers layer on layer.id = requirement.box_layer_id
        where layer.box_id = target_session.box_id
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
        packing_session_id, label_uid, raw_payload_hash, scanned_part_no,
        scanned_size, normalized_size, product_id, box_layer_id, result,
        scanned_by, correlation_id
      ) values (
        target_session.id, normalized_label_uid, raw_hash, target_item.part_no,
        btrim(p_scanned_size), normalized_size, selected_product_id,
        selected_box_layer_id, 'accepted', auth.uid(), scan_correlation_id
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
      packing_session_id, label_uid, raw_payload_hash, scanned_part_no,
      scanned_size, normalized_size, product_id, box_layer_id, result,
      error_code, scanned_by, correlation_id
    ) values (
      target_session.id, normalized_label_uid, raw_hash, target_item.part_no,
      btrim(p_scanned_size), normalized_size, selected_product_id, null,
      scan_result_value, scan_error_code, auth.uid(), scan_correlation_id
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

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata, correlation_id)
  values (
    auth.uid(),
    case when scan_result_value = 'accepted' then 'packing_scan.accepted' else 'packing_scan.rejected' end,
    'packing_session_scan', target_session.id::text,
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
    scan_result_value, scan_error_code, target_session.id, resulting_status,
    selected_product_id, selected_box_layer_id, selected_layer_accepted_qty,
    selected_layer_expected_qty, accepted_total, expected_total, resulting_ready_at;
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
      existing_job.id, target_session.id, target_session.status,
      existing_job.sequence_no, existing_job.label_reference,
      existing_job.supplier_code_snapshot, existing_job.supplier_name_snapshot,
      existing_job.part_no_snapshot, existing_job.part_name_snapshot,
      existing_job.qty_snapshot, existing_job.delivery_number_snapshot,
      existing_job.delivery_date_snapshot, existing_job.box_code_snapshot,
      existing_job.box_name_snapshot, true;
    return;
  end if;

  if target_session.status <> 'ready_to_finalize' then
    raise exception using errcode = 'P0001', message = 'SESSION_NOT_COMPLETE';
  end if;

  select * into target_item from public.master_items item where item.id = target_session.master_item_id;
  select * into target_box from public.boxes box where box.id = target_session.box_id;

  select coalesce(sum(requirement.expected_qty), 0)::integer into expected_total
  from public.box_layer_requirements requirement
  join public.box_layers layer on layer.id = requirement.box_layer_id
  where layer.box_id = target_session.box_id;

  select count(*)::integer into accepted_total
  from public.packing_session_scans scan
  where scan.packing_session_id = target_session.id
    and scan.result = 'accepted';

  if expected_total <= 0 or accepted_total <> expected_total then
    raise exception using errcode = 'P0001', message = 'SESSION_NOT_COMPLETE';
  end if;

  select * into target_dn from public.delivery_numbers dn
  where dn.id = p_delivery_number_id and dn.status = 'active';

  if target_dn.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  select * into target_supplier from public.suppliers supplier where supplier.id = target_dn.supplier_id;

  if target_supplier.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  select nextval('public.print_job_sequence') into new_sequence_no;

  new_label_reference := new_sequence_no::text || '-'
    || to_char(target_dn.delivery_date, 'DDMMYY') || '-' || target_box.box_code;

  insert into public.print_jobs (
    packing_session_id, status, supplier_code_snapshot, supplier_name_snapshot,
    part_no_snapshot, part_name_snapshot, qty_snapshot, delivery_number_snapshot,
    delivery_date_snapshot, box_code_snapshot, box_name_snapshot, sequence_no,
    label_reference, template_version, zpl_payload, created_by
  ) values (
    target_session.id, 'pending', target_supplier.supplier_code, target_supplier.supplier_name,
    target_item.part_no, target_item.part_name, target_item.default_label_qty,
    target_dn.delivery_number, target_dn.delivery_date, target_box.box_code, target_box.box_name,
    new_sequence_no, new_label_reference, 'v1', 'PENDING_ZPL_GENERATION', auth.uid()
  )
  returning * into new_job;

  update public.packing_sessions session
  set status = 'print_pending', delivery_number_id = p_delivery_number_id, finalized_at = statement_timestamp()
  where session.id = target_session.id
  returning session.status into resulting_status;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata, correlation_id)
  values (
    auth.uid(), 'packing_session.finalized', 'packing_session', target_session.id::text,
    jsonb_build_object(
      'print_job_id', new_job.id, 'sequence_no', new_sequence_no,
      'label_reference', new_label_reference, 'delivery_number_id', p_delivery_number_id,
      'master_item_id', target_session.master_item_id, 'box_id', target_session.box_id,
      'qty_snapshot', target_item.default_label_qty
    ),
    finalize_correlation_id
  );

  return query
  select
    new_job.id, target_session.id, resulting_status, new_sequence_no, new_label_reference,
    target_supplier.supplier_code, target_supplier.supplier_name, target_item.part_no,
    target_item.part_name, target_item.default_label_qty, target_dn.delivery_number,
    target_dn.delivery_date, target_box.box_code, target_box.box_name, false;
end;
$$;

revoke execute on function public.start_packing_session(uuid, uuid) from public, anon;
revoke execute on function public.accept_packing_scan(uuid, text, text, text, text) from public, anon;
revoke execute on function public.finalize_packing_session(uuid, uuid) from public, anon;
grant execute on function public.start_packing_session(uuid, uuid) to authenticated;
grant execute on function public.accept_packing_scan(uuid, text, text, text, text) to authenticated;
grant execute on function public.finalize_packing_session(uuid, uuid) to authenticated;

-- 14. Delivery Number RPCs: allow operators, not just admins ---------------

create or replace function public.create_delivery_number(
  p_supplier_id uuid,
  p_delivery_number text,
  p_delivery_date date,
  p_status public.delivery_status default 'draft'
)
returns table (
  id uuid,
  supplier_id uuid,
  delivery_number text,
  delivery_date date,
  status public.delivery_status,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_number text := upper(btrim(p_delivery_number));
begin
  if not (private.is_active_operator() or private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_FORBIDDEN';
  end if;

  if normalized_number !~ '^[A-Z0-9][A-Z0-9_/-]{1,99}$'
    or p_delivery_date is null
    or p_status not in ('draft', 'active') then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INPUT_INVALID';
  end if;

  if not exists (
    select 1 from public.suppliers
    where public.suppliers.id = p_supplier_id and public.suppliers.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_SUPPLIER_INVALID';
  end if;

  begin
    insert into public.delivery_numbers (supplier_id, delivery_number, delivery_date, status, created_by)
    values (p_supplier_id, normalized_number, p_delivery_date, p_status, auth.uid())
    returning * into id, supplier_id, delivery_number, delivery_date, status, created_by, created_at, updated_at;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_EXISTS';
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'delivery_number.created', 'delivery_number', id::text,
    jsonb_build_object('supplier_id', supplier_id, 'delivery_number', delivery_number,
      'delivery_date', delivery_date, 'status', status)
  );

  return next;
end;
$$;

create or replace function public.update_delivery_number(
  p_delivery_number_id uuid,
  p_supplier_id uuid,
  p_delivery_number text,
  p_delivery_date date
)
returns table (
  id uuid,
  supplier_id uuid,
  delivery_number text,
  delivery_date date,
  status public.delivery_status,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target public.delivery_numbers%rowtype;
  normalized_number text := upper(btrim(p_delivery_number));
begin
  if not (private.is_active_operator() or private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_FORBIDDEN';
  end if;

  if normalized_number !~ '^[A-Z0-9][A-Z0-9_/-]{1,99}$'
    or p_delivery_date is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INPUT_INVALID';
  end if;

  select * into target from public.delivery_numbers
  where public.delivery_numbers.id = p_delivery_number_id for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_NOT_FOUND';
  end if;

  if target.status in ('closed', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_TERMINAL';
  end if;

  if not exists (
    select 1 from public.suppliers
    where public.suppliers.id = p_supplier_id and public.suppliers.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_SUPPLIER_INVALID';
  end if;

  begin
    update public.delivery_numbers
    set supplier_id = p_supplier_id, delivery_number = normalized_number, delivery_date = p_delivery_date
    where public.delivery_numbers.id = p_delivery_number_id
    returning * into id, supplier_id, delivery_number, delivery_date, status, created_by, created_at, updated_at;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_EXISTS';
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'delivery_number.updated', 'delivery_number', id::text,
    jsonb_build_object('supplier_id', supplier_id, 'delivery_number', delivery_number, 'delivery_date', delivery_date)
  );

  return next;
end;
$$;

create or replace function public.close_or_cancel_delivery_number(
  p_delivery_number_id uuid,
  p_status public.delivery_status
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target public.delivery_numbers%rowtype;
begin
  if not (private.is_active_operator() or private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_FORBIDDEN';
  end if;

  if p_status not in ('closed', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_STATUS_INVALID';
  end if;

  select * into target from public.delivery_numbers
  where public.delivery_numbers.id = p_delivery_number_id for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_NOT_FOUND';
  end if;

  if target.status in ('closed', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_TERMINAL';
  end if;

  update public.delivery_numbers set status = p_status where public.delivery_numbers.id = p_delivery_number_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when p_status = 'closed' then 'delivery_number.closed' else 'delivery_number.cancelled' end,
    'delivery_number', p_delivery_number_id::text,
    jsonb_build_object('previous_status', target.status, 'status', p_status)
  );
end;
$$;
