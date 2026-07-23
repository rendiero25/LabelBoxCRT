# Box Restructure into Master Item — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Box from standalone shared master data into a per-Master-Item nested structure (max 3 Box slots, auto id/name, nested Layers, per-layer product requirements), clean up the Master Item form, and move Delivery Number CRUD from its own admin page into the operator Scan page.

**Architecture:** One foundational DB migration (`supabase/migrations/20260723150000_box_owned_by_master_item.sql`) restructures `boxes`/`box_layers`/`box_layer_requirements`, drops `master_item_boxes` and its versioning RPCs, repoints `packing_sessions`/scan/finalize RPCs, drops `master_items.item_sequence_code`, and loosens the Delivery Number RPC gate to operators. Everything else is a thin Next.js Server Actions + Supabase-js layer on top, following the exact patterns already used by `src/features/boxes` (being deleted) and `src/features/master-items`.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RPC via `security definer` functions + RLS), React 19 Server Actions, Tailwind, shadcn/ui, vitest, pgTAP.

Spec: [docs/superpowers/specs/2026-07-23-box-restructure-master-item-design.md](../specs/2026-07-23-box-restructure-master-item-design.md)

---

## Task ordering

Task 1 is a hard prerequisite for everything else (new RPC names, new table shape, regenerated `src/types/database.ts`). Tasks 2–9 touch disjoint files and can run in parallel once Task 1 is committed. Task 10 runs last.

```
Task 1 (DB + types)
   |
   +--> Task 2 (master-items data layer: validation/box-layer-requirements/actions)
   +--> Task 3 (master-item-box-layer-editor.tsx)
   +--> Task 4 (master-item-directory.tsx)
   +--> Task 5 (admin/master-items/page.tsx)
   +--> Task 6 (remove Box menu + admin Delivery Number route)
   +--> Task 7 (csv-imports/templates.ts)
   +--> Task 8 (delivery-numbers data layer + inline create dialog)
   +--> Task 9 (scan/packing repoint)
         |
         v
      Task 10 (typecheck/lint/test verification)
```

Tasks 3, 4, 5 depend on exact export names from Task 2 and each other — those exact names/signatures are fully specified below so each task can be implemented without waiting on the others' actual file contents. Same for Task 8 → Task 9 (the new `CreateDeliveryNumberDialog` component).

---

## Task 1: Database migration — Box owned by Master Item

**Files:**
- Create: `supabase/migrations/20260723150000_box_owned_by_master_item.sql`
- Modify: `supabase/tests/database/001_phase_2_schema.test.sql`
- Modify: `supabase/tests/database/002_phase_2_rls.test.sql`
- Modify: `supabase/tests/database/014_phase_5_packing_session_scan.test.sql`
- Modify: `supabase/tests/database/015_phase_6_finalize.test.sql`
- Modify: `supabase/tests/database/017_master_item_code_autogen.test.sql`
- Modify: `supabase/tests/database/012_phase_4_7_csv_import.test.sql`
- Delete: `supabase/tests/database/011_phase_4_6_box.test.sql`
- Delete: `supabase/tests/database/013_master_item_box_layer_requirements.test.sql`
- Create: `supabase/tests/database/018_box_owned_by_master_item.test.sql`
- Modify (regenerate): `src/types/database.ts`

This is a dev-stage reset (approved): existing `boxes`/`box_layers`/`box_layer_requirements`/`master_item_boxes` rows, and everything downstream that FKs to them (`packing_sessions`, `packing_session_scans`, `print_jobs`, `print_attempts`, `reprint_requests`), are truncated. Nothing else is touched.

- [ ] **Step 1: Write the migration file**

```sql
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

  select * into target_box from public.boxes where id = p_box_id;
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
```

- [ ] **Step 2: Apply the migration**

Run from the repo root:
```bash
npx supabase db push
```
Expected: prompts to apply `20260723150000_box_owned_by_master_item.sql`, confirm, and it applies with no errors. If it errors, read the message, fix the SQL file, and re-run — do not hand-edit remote state directly.

- [ ] **Step 3: Regenerate TypeScript types**

```bash
npx supabase gen types typescript --linked > src/types/database.ts
```
Expected: `src/types/database.ts` rewritten; `git diff src/types/database.ts` shows `boxes` gaining `master_item_id`/`box_no` and losing `is_active`, `box_layers` losing `is_active`, `box_layer_requirements` losing `master_item_box_id`, `master_item_boxes` gone, `master_items` losing `item_sequence_code`, `packing_sessions` gaining `box_id`/losing `master_item_box_id` and `version`.

- [ ] **Step 4: Delete obsolete pgTAP test files**

```bash
git rm supabase/tests/database/011_phase_4_6_box.test.sql
git rm supabase/tests/database/013_master_item_box_layer_requirements.test.sql
```

- [ ] **Step 5: Write the replacement pgTAP test file**

Create `supabase/tests/database/018_box_owned_by_master_item.test.sql`:

```sql
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(20);

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('91180000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
    'box-owned-admin@example.test', '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('91180000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
    'box-owned-operator@example.test', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.profiles (id, display_name, role, is_active) values
  ('91180000-0000-0000-0000-000000000001', 'Box Owned Admin', 'admin', true),
  ('91180000-0000-0000-0000-000000000002', 'Box Owned Operator', 'operator', true);

insert into public.master_items (
  id, item_code, part_no, part_name, unit, default_label_qty, is_active
) values (
  '92180000-0000-0000-0000-000000000001', 'box-owned-item', 'BOX-OWNED-PART',
  'Box Owned Part', 'Pcs', 100, true
);

insert into public.products (
  id, product_code, part_name, outer_diameter, inner_diameter, length, is_active
) values (
  '93180000-0000-0000-0000-000000000001', 'box-owned-product', 'Box Owned Product',
  6.3, 5.5, 205, true
);

select has_function('public', 'create_master_item_box', array['uuid'], 'create_master_item_box RPC exists');
select has_function('public', 'delete_master_item_box', array['uuid'], 'delete_master_item_box RPC exists');
select has_function('public', 'create_box_layer', array['uuid'], 'create_box_layer RPC exists');
select has_function('public', 'delete_box_layer', array['uuid'], 'delete_box_layer RPC exists');
select has_function(
  'public', 'save_box_layer_requirements', array['uuid', 'jsonb'],
  'save_box_layer_requirements RPC exists'
);

select set_config('request.jwt.claim.sub', '91180000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$ select public.create_master_item_box('92180000-0000-0000-0000-000000000001') $$,
  'admin creates the first Box for a Master Item'
);
select lives_ok(
  $$ select public.create_master_item_box('92180000-0000-0000-0000-000000000001') $$,
  'admin creates a second Box'
);
select lives_ok(
  $$ select public.create_master_item_box('92180000-0000-0000-0000-000000000001') $$,
  'admin creates a third Box'
);

select is(
  (
    select string_agg(box_no::text || ':' || box_name, ',' order by box_no)
    from public.boxes where master_item_id = '92180000-0000-0000-0000-000000000001'
  ),
  '1:Box 1,2:Box 2,3:Box 3',
  'boxes get sequential auto slot number and name'
);

select matches(
  (select box_code from public.boxes where box_no = 1 and master_item_id = '92180000-0000-0000-0000-000000000001'),
  '^box-\d+$',
  'box_code is auto-generated in box-NN format'
);

select throws_ok(
  $$ select public.create_master_item_box('92180000-0000-0000-0000-000000000001') $$,
  'P0001', 'MASTER_ITEM_BOX_LIMIT_REACHED',
  'a 4th Box is rejected once 3 exist'
);

select lives_ok(
  $$
    select public.delete_master_item_box(
      (select id from public.boxes where box_no = 2 and master_item_id = '92180000-0000-0000-0000-000000000001')
    )
  $$,
  'admin deletes an unused Box'
);

select lives_ok(
  $$ select public.create_master_item_box('92180000-0000-0000-0000-000000000001') $$,
  'a new Box reuses the freed slot number'
);

select is(
  (select box_name from public.boxes where box_no = 2 and master_item_id = '92180000-0000-0000-0000-000000000001'),
  'Box 2',
  'the reused slot is named Box 2 again'
);

select lives_ok(
  $$
    select public.create_box_layer(
      (select id from public.boxes where box_no = 1 and master_item_id = '92180000-0000-0000-0000-000000000001')
    )
  $$,
  'admin adds the first Layer to Box 1'
);
select lives_ok(
  $$
    select public.create_box_layer(
      (select id from public.boxes where box_no = 1 and master_item_id = '92180000-0000-0000-0000-000000000001')
    )
  $$,
  'admin adds a second Layer to Box 1'
);

select is(
  (
    select string_agg(layer_no::text || ':' || layer_name, ',' order by layer_no)
    from public.box_layers layer
    join public.boxes box on box.id = layer.box_id
    where box.box_no = 1 and box.master_item_id = '92180000-0000-0000-0000-000000000001'
  ),
  '1:Box 1 - Layer 1,2:Box 1 - Layer 2',
  'layers get sequential auto layer number and name embedding the box number'
);

select throws_ok(
  $$
    select public.delete_box_layer(
      (select id from public.box_layers layer join public.boxes box on box.id = layer.box_id
       where box.box_no = 1 and box.master_item_id = '92180000-0000-0000-0000-000000000001' and layer.layer_no = 1)
    )
  $$,
  'P0001', 'BOX_LAYER_NOT_LAST',
  'only the highest-numbered layer of a box can be deleted'
);

select lives_ok(
  $$
    select public.save_box_layer_requirements(
      (select id from public.box_layers layer join public.boxes box on box.id = layer.box_id
       where box.box_no = 1 and box.master_item_id = '92180000-0000-0000-0000-000000000001' and layer.layer_no = 1),
      jsonb_build_array(jsonb_build_object(
        'product_id', '93180000-0000-0000-0000-000000000001', 'expected_qty', 5
      ))
    )
  $$,
  'admin saves product requirements for a layer'
);

select is(
  (
    select count(*)::integer from public.master_item_products
    where master_item_id = '92180000-0000-0000-0000-000000000001'
      and product_id = '93180000-0000-0000-0000-000000000001' and is_active
  ),
  1,
  'saving a requirement auto-syncs the product into master_item_products'
);

select set_config('request.jwt.claim.sub', '91180000-0000-0000-0000-000000000002', true);

select throws_ok(
  $$ select public.create_master_item_box('92180000-0000-0000-0000-000000000001') $$,
  'P0001', 'MASTER_ITEM_BOX_ADMIN_REQUIRED', 'non-admin cannot create a Box'
);

reset role;
set local role anon;

select throws_ok(
  $$ select public.create_master_item_box('92180000-0000-0000-0000-000000000001') $$,
  '42501', 'permission denied for function create_master_item_box',
  'anon has no execute privilege on create_master_item_box'
);

reset role;

select * from finish();

rollback;
```

- [ ] **Step 6: Patch `001_phase_2_schema.test.sql`**

Read the file first, then apply these changes:
- Remove the `'item_sequence_code', 'is_active', 'created_at', 'updated_at'` entry for `master_items` columns (line ~131) — drop `'item_sequence_code',` from that list.
- Remove the entire `has_table('public', 'master_item_boxes', ...)` block and its column/index assertions (lines ~161–181).
- Replace the `box_layers` columns assertion (lines ~187–192) — remove `'is_active'` from the expected column list.
- Replace the `box_layer_requirements` columns assertion (lines ~200–205) — remove `'master_item_box_id'` from the expected column list, and rename the constraint-name assertions at lines ~209–219 from `box_layer_requirements_assignment_layer_product_key`/`box_layer_requirements_assignment_layer_sort_key` to `box_layer_requirements_layer_product_key`/`box_layer_requirements_layer_sort_key`.
- In the table list around line ~275, remove `'master_item_boxes'` from the array.
- Add new assertions (near the `boxes` table block) for `boxes.master_item_id`, `boxes.box_no`, and the `boxes_master_item_box_no_key` unique constraint, following the same `has_column`/`has_index` style already used elsewhere in the file.

- [ ] **Step 7: Patch `002_phase_2_rls.test.sql`**

Read the file first, then apply these changes:
- Update the seed inserts (around lines 52–65): the `master_item_boxes` insert is removed; the `boxes` insert (wherever it appears above line 52) must include `master_item_id` and `box_no` instead of relying on a separate assignment row; `box_layers`/`box_layer_requirements` inserts drop `is_active`/`master_item_box_id` columns respectively.
- Line ~71: `packing_sessions` insert column `master_item_box_id` → `box_id`.
- Line ~109: same rename in the `insert into public.packing_sessions (...)` test SQL string.
- Lines ~179–180: the RLS check joining `master_item_boxes`/`boxes` becomes a direct join from `packing_sessions.box_id` to `boxes`.

- [ ] **Step 8: Patch `014_phase_5_packing_session_scan.test.sql` and `015_phase_6_finalize.test.sql`**

Read each file first. In both:
- Any seed data that builds `master_item_boxes` rows is removed; `boxes` seed rows get `master_item_id`/`box_no` directly.
- `start_packing_session(p_master_item_id, p_master_item_box_id)` calls become `start_packing_session(p_master_item_id, p_box_id)` passing a `boxes.id` directly.
- Any reference to `packing_sessions.master_item_box_id` becomes `packing_sessions.box_id`.
- Any reference to `box_definitions`/`master_item_boxes` versioning (`version`, `is_active` on the assignment) is removed — boxes have no version/is_active anymore.

- [ ] **Step 9: Patch `017_master_item_code_autogen.test.sql`**

Read the file first. Any call to `create_master_item(...)` or `update_master_item(...)` passing `p_item_sequence_code` drops that argument, matching the new 5-arg/5-arg signatures (`create_master_item(p_part_no, p_part_name, p_unit, p_default_label_qty, p_item_code default null)` and `update_master_item(p_master_item_id, p_part_no, p_part_name, p_unit, p_default_label_qty)`).

- [ ] **Step 10: Patch `012_phase_4_7_csv_import.test.sql`**

Read the file first. Remove any assertion that a `master_item` CSV row's `item_sequence_code` column is validated/rejected (the column no longer exists in the template); keep the rest of the CSV import coverage (supplier/product/product_mapping/delivery_number templates) unchanged.

- [ ] **Step 11: Run the pgTAP suite**

```bash
npx supabase test db
```
Expected: all tests pass. Fix any remaining reference to `master_item_boxes`, `box_definitions`, `item_sequence_code`, `box.is_active`, `box_layers.is_active`, or `packing_sessions.version`/`master_item_box_id` surfaced by failures.

- [ ] **Step 12: Commit**

```bash
git add supabase/migrations/20260723150000_box_owned_by_master_item.sql supabase/tests/database src/types/database.ts
git commit -m "feat: restructure Box as nested Master Item data, drop item_sequence_code, allow operators to manage Delivery Number"
```

---

## Task 2: Master Item data layer — validation, box-layer-requirements, actions

**Files:**
- Modify: `src/features/master-items/validation.ts`
- Create: `src/features/master-items/validation.test.ts`
- Modify: `src/features/master-items/box-layer-requirements.ts`
- Modify: `src/features/master-items/actions.ts`

- [ ] **Step 1: Rewrite `src/features/master-items/validation.ts`**

```typescript
const partNoPattern = /^[A-Z0-9][A-Z0-9_./-]{1,127}$/
const unitPattern = /^[A-Za-z][A-Za-z ./-]{0,31}$/

type MasterItemInput = {
  partNo: string
  partName: string
  unit: string
  defaultLabelQty: number
}

function normalizeUnit(value: string): string {
  const normalized = value.trim().toLowerCase()
  return normalized
    ? `${normalized[0].toUpperCase()}${normalized.slice(1)}`
    : ""
}

export function parseMasterItemInput(
  formData: FormData,
): { data: MasterItemInput } | { error: string } {
  const partNo = String(formData.get("partNo") ?? "")
    .trim()
    .toUpperCase()
  const partName = String(formData.get("partName") ?? "").trim()
  const unit = normalizeUnit(String(formData.get("unit") ?? ""))
  const rawQuantity = String(formData.get("defaultLabelQty") ?? "").trim()

  if (!partNoPattern.test(partNo)) {
    return {
      error:
        "Part No harus 2–128 karakter huruf besar, angka, titik, garis bawah, garis miring, atau tanda minus.",
    }
  }
  if (!partName) return { error: "Nama part wajib diisi." }
  if (partName.length > 200)
    return { error: "Nama part maksimal 200 karakter." }
  if (!unitPattern.test(unit)) return { error: "Unit tidak valid." }
  if (!/^[1-9]\d{0,5}$/.test(rawQuantity)) {
    return {
      error: "Packing Qty harus berupa bilangan bulat lebih besar dari 0.",
    }
  }

  return {
    data: {
      partNo,
      partName,
      unit,
      defaultLabelQty: Number(rawQuantity),
    },
  }
}

export function masterItemRpcErrorMessage(message: string): string {
  const messages: Record<string, string> = {
    MASTER_ITEM_ADMIN_REQUIRED: "Aksi ini hanya tersedia untuk admin aktif.",
    MASTER_ITEM_CODE_EXISTS: "Kode item sudah digunakan.",
    MASTER_ITEM_IN_USE:
      "Master Item sudah memiliki session dan tidak dapat diubah.",
    MASTER_ITEM_INPUT_INVALID: "Data Master Item tidak valid.",
    MASTER_ITEM_NOT_FOUND: "Master Item tidak ditemukan.",
    MASTER_ITEM_PART_NO_EXISTS: "Part No sudah digunakan.",
  }

  return (
    messages[message] ?? "Aksi Master Item gagal. Coba lagi atau hubungi admin."
  )
}
```

- [ ] **Step 2: Write the failing test**

Create `src/features/master-items/validation.test.ts`:

```typescript
import { describe, expect, it } from "vitest"

import {
  masterItemRpcErrorMessage,
  parseMasterItemInput,
} from "@/features/master-items/validation"

function validFormData(): FormData {
  const formData = new FormData()
  formData.set("partNo", "3210a-k1z-na01-dl")
  formData.set("partName", " Tube Assy ")
  formData.set("unit", "PCS")
  formData.set("defaultLabelQty", "100")
  return formData
}

describe("parseMasterItemInput", () => {
  it("normalizes part no, part name, unit, and qty", () => {
    expect(parseMasterItemInput(validFormData())).toEqual({
      data: {
        partNo: "3210A-K1Z-NA01-DL",
        partName: "Tube Assy",
        unit: "Pcs",
        defaultLabelQty: 100,
      },
    })
  })

  it("no longer reads or requires itemSequenceCode", () => {
    const formData = validFormData()
    formData.set("itemSequenceCode", "LINE-A")
    const result = parseMasterItemInput(formData)
    expect("data" in result && "itemSequenceCode" in result.data).toBe(false)
  })

  it("rejects a zero packing qty with the Packing Qty wording", () => {
    const formData = validFormData()
    formData.set("defaultLabelQty", "0")

    expect(parseMasterItemInput(formData)).toEqual({
      error: "Packing Qty harus berupa bilangan bulat lebih besar dari 0.",
    })
  })

  it("rejects an invalid part no", () => {
    const formData = validFormData()
    formData.set("partNo", "!!")

    expect(parseMasterItemInput(formData).error).toMatch(/Part No/)
  })
})

describe("masterItemRpcErrorMessage", () => {
  it.each([
    ["MASTER_ITEM_CODE_EXISTS", "Kode item sudah digunakan."],
    ["MASTER_ITEM_PART_NO_EXISTS", "Part No sudah digunakan."],
  ])("maps %s to a safe Indonesian message", (code, message) => {
    expect(masterItemRpcErrorMessage(code)).toBe(message)
  })

  it("hides unexpected RPC errors", () => {
    expect(masterItemRpcErrorMessage("database detail")).toBe(
      "Aksi Master Item gagal. Coba lagi atau hubungi admin.",
    )
  })
})
```

- [ ] **Step 3: Run the test to verify it passes against the Step 1 implementation**

```bash
npx vitest run src/features/master-items/validation.test.ts
```
Expected: PASS (validation.ts was already rewritten in Step 1).

- [ ] **Step 4: Rewrite `src/features/master-items/box-layer-requirements.ts`**

```typescript
export type BoxLayerRequirementInput = {
  productId: string
  expectedQty: number
}

type ParseResult =
  | { data: BoxLayerRequirementInput[] }
  | { error: string }

export function parseBoxLayerRequirementsInput(
  formData: FormData,
): ParseResult {
  const rawRequirements = String(formData.get("requirements") ?? "")
  let requirements: unknown

  try {
    requirements = JSON.parse(rawRequirements)
  } catch {
    return { error: "Requirement produk tidak valid." }
  }

  if (!Array.isArray(requirements)) {
    return { error: "Requirement produk tidak valid." }
  }
  if (requirements.length === 0) {
    return { error: "Minimal satu requirement wajib diisi." }
  }

  const parsedRequirements: BoxLayerRequirementInput[] = []
  const productIds = new Set<string>()

  for (const requirement of requirements) {
    if (!requirement || typeof requirement !== "object") {
      return { error: "Produk requirement wajib dipilih." }
    }

    const { productId, expectedQty } = requirement as {
      productId?: unknown
      expectedQty?: unknown
    }
    const normalizedProductId =
      typeof productId === "string" ? productId.trim() : ""
    const rawExpectedQty =
      typeof expectedQty === "string" || typeof expectedQty === "number"
        ? String(expectedQty).trim()
        : ""

    if (!normalizedProductId) {
      return { error: "Produk requirement wajib dipilih." }
    }
    if (productIds.has(normalizedProductId)) {
      return { error: "Produk requirement tidak boleh duplikat dalam satu layer." }
    }
    if (
      !/^\d+$/.test(rawExpectedQty) ||
      Number(rawExpectedQty) < 1 ||
      Number(rawExpectedQty) > 1_000_000
    ) {
      return {
        error: "Qty requirement harus berupa bilangan bulat lebih besar dari 0.",
      }
    }

    productIds.add(normalizedProductId)
    parsedRequirements.push({
      productId: normalizedProductId,
      expectedQty: Number(rawExpectedQty),
    })
  }

  return { data: parsedRequirements }
}

export function masterItemBoxRpcErrorMessage(message: string): string {
  const messages: Record<string, string> = {
    MASTER_ITEM_BOX_ADMIN_REQUIRED: "Aksi ini hanya tersedia untuk admin aktif.",
    MASTER_ITEM_BOX_MASTER_ITEM_NOT_FOUND:
      "Master Item tidak aktif atau tidak ditemukan.",
    MASTER_ITEM_BOX_LIMIT_REACHED: "Maksimal 3 Box per Master Item.",
    MASTER_ITEM_BOX_NOT_FOUND: "Box tidak ditemukan.",
    MASTER_ITEM_BOX_IN_USE: "Box sudah dipakai packing session dan terkunci.",
    MASTER_ITEM_BOX_INPUT_INVALID: "Data kebutuhan produk tidak valid.",
    MASTER_ITEM_BOX_PRODUCT_NOT_ALLOWED:
      "Produk requirement tidak diizinkan untuk Master Item ini.",
    BOX_LAYER_LIMIT_REACHED: "Maksimal 10 layer per Box.",
    BOX_LAYER_NOT_FOUND: "Layer tidak ditemukan.",
    BOX_LAYER_NOT_LAST:
      "Hanya layer terakhir yang bisa dihapus.",
  }

  return (
    messages[message] ??
    "Aksi Box/Layer Master Item gagal. Coba lagi atau hubungi admin."
  )
}
```

- [ ] **Step 5: Rewrite `src/features/master-items/actions.ts`**

```typescript
"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/features/auth/server"
import type { MasterItemActionState } from "@/features/master-items/form-state"
import {
  masterItemBoxRpcErrorMessage,
  parseBoxLayerRequirementsInput,
} from "@/features/master-items/box-layer-requirements"
import {
  masterItemRpcErrorMessage,
  parseMasterItemInput,
} from "@/features/master-items/validation"
import { createClient } from "@/lib/supabase/server"
import type { Json } from "@/types/database"

function masterItemIdFromFormData(formData: FormData): string | null {
  const masterItemId = formData.get("masterItemId")
  return typeof masterItemId === "string" && masterItemId ? masterItemId : null
}

export async function createMasterItemAction(
  _previousState: MasterItemActionState,
  formData: FormData,
): Promise<MasterItemActionState> {
  await requireAdmin()
  const parsed = parseMasterItemInput(formData)
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("create_master_item", {
    p_part_no: parsed.data.partNo,
    p_part_name: parsed.data.partName,
    p_unit: parsed.data.unit,
    p_default_label_qty: parsed.data.defaultLabelQty,
  })

  if (error) return { error: masterItemRpcErrorMessage(error.message) }

  revalidatePath("/admin/master-items")
  return { success: "Master Item dibuat." }
}

export async function updateMasterItemAction(
  _previousState: MasterItemActionState,
  formData: FormData,
): Promise<MasterItemActionState> {
  await requireAdmin()
  const masterItemId = masterItemIdFromFormData(formData)
  const parsed = parseMasterItemInput(formData)
  if (!masterItemId) return { error: "Master Item tidak valid." }
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("update_master_item", {
    p_master_item_id: masterItemId,
    p_part_no: parsed.data.partNo,
    p_part_name: parsed.data.partName,
    p_unit: parsed.data.unit,
    p_default_label_qty: parsed.data.defaultLabelQty,
  })

  if (error) return { error: masterItemRpcErrorMessage(error.message) }

  revalidatePath("/admin/master-items")
  return { success: "Master Item diperbarui." }
}

export async function setMasterItemActiveAction(
  _previousState: MasterItemActionState,
  formData: FormData,
): Promise<MasterItemActionState> {
  await requireAdmin()
  const masterItemId = masterItemIdFromFormData(formData)
  const isActive = formData.get("isActive") === "true"
  if (!masterItemId) return { error: "Master Item tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("set_master_item_active", {
    p_master_item_id: masterItemId,
    p_is_active: isActive,
  })

  if (error) return { error: masterItemRpcErrorMessage(error.message) }

  revalidatePath("/admin/master-items")
  return {
    success: isActive
      ? "Master Item diaktifkan."
      : "Master Item dinonaktifkan.",
  }
}

function revalidateMasterItems() {
  revalidatePath("/admin/master-items")
}

export async function createMasterItemBoxAction(
  _previousState: MasterItemActionState,
  formData: FormData,
): Promise<MasterItemActionState> {
  await requireAdmin()
  const masterItemId = masterItemIdFromFormData(formData)
  if (!masterItemId) return { error: "Master Item tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("create_master_item_box", {
    p_master_item_id: masterItemId,
  })

  if (error) return { error: masterItemBoxRpcErrorMessage(error.message) }

  revalidateMasterItems()
  return { success: "Box dibuat." }
}

export async function deleteMasterItemBoxAction(
  _previousState: MasterItemActionState,
  formData: FormData,
): Promise<MasterItemActionState> {
  await requireAdmin()
  const boxId = String(formData.get("boxId") ?? "").trim()
  if (!boxId) return { error: "Box tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_master_item_box", {
    p_box_id: boxId,
  })

  if (error) return { error: masterItemBoxRpcErrorMessage(error.message) }

  revalidateMasterItems()
  return { success: "Box dihapus." }
}

export async function createBoxLayerAction(
  _previousState: MasterItemActionState,
  formData: FormData,
): Promise<MasterItemActionState> {
  await requireAdmin()
  const boxId = String(formData.get("boxId") ?? "").trim()
  if (!boxId) return { error: "Box tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("create_box_layer", {
    p_box_id: boxId,
  })

  if (error) return { error: masterItemBoxRpcErrorMessage(error.message) }

  revalidateMasterItems()
  return { success: "Layer ditambahkan." }
}

export async function deleteBoxLayerAction(
  _previousState: MasterItemActionState,
  formData: FormData,
): Promise<MasterItemActionState> {
  await requireAdmin()
  const boxLayerId = String(formData.get("boxLayerId") ?? "").trim()
  if (!boxLayerId) return { error: "Layer tidak valid." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("delete_box_layer", {
    p_box_layer_id: boxLayerId,
  })

  if (error) return { error: masterItemBoxRpcErrorMessage(error.message) }

  revalidateMasterItems()
  return { success: "Layer dihapus." }
}

export async function saveBoxLayerRequirementsAction(
  _previousState: MasterItemActionState,
  formData: FormData,
): Promise<MasterItemActionState> {
  await requireAdmin()
  const boxLayerId = String(formData.get("boxLayerId") ?? "").trim()
  const parsed = parseBoxLayerRequirementsInput(formData)
  if (!boxLayerId) return { error: "Layer tidak valid." }
  if ("error" in parsed) return { error: parsed.error }

  const supabase = await createClient()
  const { error } = await supabase.rpc("save_box_layer_requirements", {
    p_box_layer_id: boxLayerId,
    p_requirements: parsed.data.map((requirement) => ({
      product_id: requirement.productId,
      expected_qty: requirement.expectedQty,
    })) as Json,
  })

  if (error) return { error: masterItemBoxRpcErrorMessage(error.message) }

  revalidateMasterItems()
  return { success: "Produk per layer disimpan." }
}
```

- [ ] **Step 6: Run typecheck on this task's files**

```bash
npx tsc --noEmit
```
Expected: no new errors from `src/features/master-items/*` (other files will still error until Tasks 3–5 land — that's expected at this point if run in isolation; full green happens at Task 10).

- [ ] **Step 7: Commit**

```bash
git add src/features/master-items/validation.ts src/features/master-items/validation.test.ts src/features/master-items/box-layer-requirements.ts src/features/master-items/actions.ts
git commit -m "feat: rewrite Master Item validation/actions for nested Box/Layer and dropped item_sequence_code"
```

---

## Task 3: Master Item Box/Layer editor component

**Files:**
- Modify: `src/features/master-items/components/master-item-box-layer-editor.tsx`

- [ ] **Step 1: Replace the full file content**

```typescript
"use client"

import { useActionState, useState } from "react"
import { CircleAlertIcon, PlusIcon, Trash2Icon } from "lucide-react"

import {
  createBoxLayerAction,
  createMasterItemBoxAction,
  deleteBoxLayerAction,
  deleteMasterItemBoxAction,
  saveBoxLayerRequirementsAction,
} from "@/features/master-items/actions"
import { initialMasterItemActionState } from "@/features/master-items/form-state"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"

export type MasterItem = {
  id: string
  item_code: string
  part_no: string
  part_name: string
  unit: string
  default_label_qty: number
  is_active: boolean
}

export type ProductOption = {
  id: string
  productCode: string
  partName: string
  outerDiameter: number | null
  innerDiameter: number | null
  length: number | null
  normalizedDimensions: string | null
}

export type BoxLayerRequirement = {
  productId: string
  expectedQty: number
}

export type BoxLayer = {
  id: string
  layerNo: number
  layerName: string
  requirements: BoxLayerRequirement[]
}

export type MasterItemBox = {
  id: string
  masterItemId: string
  boxNo: number
  boxCode: string
  boxName: string
  isUsed: boolean
  layers: BoxLayer[]
}

function productLabel(product: ProductOption) {
  return `${product.productCode} - ${product.partName}${product.normalizedDimensions ? ` (${product.normalizedDimensions})` : ""}`
}

export function MasterItemBoxLayerEditor({
  masterItem,
  boxes,
  products,
}: {
  masterItem: MasterItem
  boxes: MasterItemBox[]
  products: ProductOption[]
}) {
  const ownBoxes = boxes
    .filter((box) => box.masterItemId === masterItem.id)
    .sort((a, b) => a.boxNo - b.boxNo)

  const [createBoxState, createBoxAction, isCreatingBox] = useActionState(
    createMasterItemBoxAction,
    initialMasterItemActionState,
  )
  useActionStateToast(createBoxState)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Kelola Box
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Box dan Layer</DialogTitle>
          <DialogDescription>
            {masterItem.item_code} · {masterItem.part_no} · {masterItem.part_name}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {ownBoxes.map((box) => (
            <BoxCard
              box={box}
              itemCode={masterItem.item_code}
              key={box.id}
              products={products}
            />
          ))}

          <form action={createBoxAction}>
            <input name="masterItemId" type="hidden" value={masterItem.id} />
            <Button
              disabled={isCreatingBox || ownBoxes.length >= 3}
              type="submit"
              variant="outline"
            >
              {isCreatingBox ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <PlusIcon data-icon="inline-start" />
              )}
              Tambah Box {ownBoxes.length >= 3 ? "(maksimal 3)" : ""}
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function BoxCard({
  box,
  itemCode,
  products,
}: {
  box: MasterItemBox
  itemCode: string
  products: ProductOption[]
}) {
  const [deleteBoxState, deleteBoxAction, isDeletingBox] = useActionState(
    deleteMasterItemBoxAction,
    initialMasterItemActionState,
  )
  const [createLayerState, createLayerAction, isCreatingLayer] = useActionState(
    createBoxLayerAction,
    initialMasterItemActionState,
  )
  useActionStateToast(deleteBoxState)
  useActionStateToast(createLayerState)

  const sortedLayers = box.layers.slice().sort((a, b) => a.layerNo - b.layerNo)
  const highestLayerNo = sortedLayers.at(-1)?.layerNo ?? 0

  return (
    <section className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">
            {itemCode} - {box.boxName}
          </h3>
          <p className="text-muted-foreground text-xs">
            ID: {box.boxCode}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {box.isUsed ? <Badge variant="secondary">Terpakai</Badge> : null}
          {!box.isUsed ? (
            <form action={deleteBoxAction}>
              <input name="boxId" type="hidden" value={box.id} />
              <Button
                disabled={isDeletingBox}
                size="sm"
                type="submit"
                variant="destructive"
              >
                {isDeletingBox ? <Spinner data-icon="inline-start" /> : (
                  <Trash2Icon data-icon="inline-start" />
                )}
                Hapus Box
              </Button>
            </form>
          ) : null}
        </div>
      </div>

      {deleteBoxState.error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{deleteBoxState.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3">
        {sortedLayers.map((layer) => (
          <LayerCard
            box={box}
            highestLayerNo={highestLayerNo}
            itemCode={itemCode}
            key={layer.id}
            layer={layer}
            products={products}
          />
        ))}
      </div>

      {!box.isUsed ? (
        <form action={createLayerAction}>
          <input name="boxId" type="hidden" value={box.id} />
          <Button
            disabled={isCreatingLayer || sortedLayers.length >= 10}
            size="sm"
            type="submit"
            variant="outline"
          >
            {isCreatingLayer ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <PlusIcon data-icon="inline-start" />
            )}
            Tambah Layer {sortedLayers.length >= 10 ? "(maksimal 10)" : ""}
          </Button>
        </form>
      ) : null}
      {createLayerState.error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{createLayerState.error}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}

function LayerCard({
  box,
  highestLayerNo,
  itemCode,
  layer,
  products,
}: {
  box: MasterItemBox
  highestLayerNo: number
  itemCode: string
  layer: BoxLayer
  products: ProductOption[]
}) {
  const [requirements, setRequirements] = useState<BoxLayerRequirement[]>(
    layer.requirements.length > 0
      ? layer.requirements
      : [{ productId: "", expectedQty: 1 }],
  )
  const [deleteLayerState, deleteLayerAction, isDeletingLayer] = useActionState(
    deleteBoxLayerAction,
    initialMasterItemActionState,
  )
  const [saveState, saveAction, isSaving] = useActionState(
    saveBoxLayerRequirementsAction,
    initialMasterItemActionState,
  )
  useActionStateToast(deleteLayerState)
  useActionStateToast(saveState)

  const canDeleteLayer = !box.isUsed && layer.layerNo === highestLayerNo

  function updateRequirement(
    index: number,
    update: Partial<{ productId: string; expectedQty: number }>,
  ) {
    setRequirements(
      requirements.map((requirement, requirementIndex) =>
        requirementIndex === index
          ? { ...requirement, ...update }
          : requirement,
      ),
    )
  }

  function addRequirement() {
    setRequirements([...requirements, { productId: "", expectedQty: 1 }])
  }

  function removeRequirement(index: number) {
    if (requirements.length <= 1) return
    setRequirements(requirements.filter((_, requirementIndex) => requirementIndex !== index))
  }

  const selectedElsewhere = (indexToKeep: number) =>
    new Set(
      requirements
        .filter((_, index) => index !== indexToKeep)
        .map((requirement) => requirement.productId)
        .filter(Boolean),
    )

  return (
    <div className="rounded-md border p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium">
          {itemCode} - {layer.layerName}
        </h4>
        {canDeleteLayer ? (
          <form action={deleteLayerAction}>
            <input name="boxLayerId" type="hidden" value={layer.id} />
            <Button
              disabled={isDeletingLayer}
              size="sm"
              type="submit"
              variant="outline"
            >
              {isDeletingLayer ? <Spinner data-icon="inline-start" /> : (
                <Trash2Icon data-icon="inline-start" />
              )}
              Hapus Layer
            </Button>
          </form>
        ) : null}
      </div>

      {deleteLayerState.error ? (
        <Alert className="mb-3" variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{deleteLayerState.error}</AlertDescription>
        </Alert>
      ) : null}
      {saveState.error ? (
        <Alert className="mb-3" variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{saveState.error}</AlertDescription>
        </Alert>
      ) : null}

      <form action={saveAction} className="flex flex-col gap-3">
        <input name="boxLayerId" type="hidden" value={layer.id} />
        <input
          name="requirements"
          type="hidden"
          value={JSON.stringify(requirements)}
        />
        {requirements.map((requirement, index) => (
          <div
            className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]"
            key={`${layer.id}-${index}`}
          >
            <Field>
              <FieldLabel>Produk</FieldLabel>
              <Select
                disabled={box.isUsed}
                onValueChange={(productId) =>
                  updateRequirement(index, { productId })
                }
                value={requirement.productId}
              >
                <SelectTrigger aria-label={`Pilih produk ${layer.layerName}`}>
                  <SelectValue placeholder="Pilih produk aktif" />
                </SelectTrigger>
                <SelectContent>
                  {products
                    .filter(
                      (product) => !selectedElsewhere(index).has(product.id),
                    )
                    .map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {productLabel(product)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`qty-${layer.id}-${index}`}>Qty</FieldLabel>
              <Input
                disabled={box.isUsed}
                id={`qty-${layer.id}-${index}`}
                min={1}
                onChange={(event) =>
                  updateRequirement(index, {
                    expectedQty: Number(event.target.value),
                  })
                }
                type="number"
                value={requirement.expectedQty}
              />
            </Field>
            {!box.isUsed ? (
              <Button
                aria-label="Hapus requirement"
                className="self-end"
                disabled={requirements.length === 1}
                onClick={() => removeRequirement(index)}
                size="icon"
                type="button"
                variant="outline"
              >
                <Trash2Icon />
              </Button>
            ) : null}
          </div>
        ))}

        {!box.isUsed ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={addRequirement} type="button" variant="outline">
              <PlusIcon data-icon="inline-start" />
              Tambah produk
            </Button>
            <Button disabled={isSaving} type="submit">
              {isSaving ? <Spinner data-icon="inline-start" /> : null}
              Simpan produk layer ini
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/master-items/components/master-item-box-layer-editor.tsx
git commit -m "feat: rewrite Master Item Box/Layer editor for nested per-item Box slots"
```

---

## Task 4: Master Item directory — label rename, drop sequence field, add filter/sort/pagination

**Files:**
- Modify: `src/features/master-items/components/master-item-directory.tsx`

- [ ] **Step 1: Update the `MasterItem` type and imports**

Edit — replace:
```typescript
export type MasterItem = {
  id: string
  item_code: string
  part_no: string
  part_name: string
  unit: string
  default_label_qty: number
  item_sequence_code: string | null
  is_active: boolean
}
```
with:
```typescript
export type MasterItem = {
  id: string
  item_code: string
  part_no: string
  part_name: string
  unit: string
  default_label_qty: number
  is_active: boolean
}
```

Edit — replace the import block:
```typescript
import { useActionState, useMemo, useState } from "react"
import {
  BanIcon,
  CheckIcon,
  CircleAlertIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react"

import {
  createMasterItemAction,
  setMasterItemActiveAction,
  updateMasterItemAction,
} from "@/features/master-items/actions"
import {
  MasterItemBoxLayerEditor,
  type BoxOption,
  type MasterItemBoxAssignment,
  type ProductOption,
} from "@/features/master-items/components/master-item-box-layer-editor"
import { initialMasterItemActionState } from "@/features/master-items/form-state"
import { useActionStateToast } from "@/components/shared/action-state-toast"
```
with:
```typescript
import { useActionState, useMemo, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  BanIcon,
  CheckIcon,
  CircleAlertIcon,
  FilterIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react"

import {
  createMasterItemAction,
  setMasterItemActiveAction,
  updateMasterItemAction,
} from "@/features/master-items/actions"
import {
  MasterItemBoxLayerEditor,
  type MasterItemBox,
  type ProductOption,
} from "@/features/master-items/components/master-item-box-layer-editor"
import { initialMasterItemActionState } from "@/features/master-items/form-state"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { PaginationControls } from "@/components/shared/pagination-controls"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
```

- [ ] **Step 2: Replace the component body with filter/sort/pagination and the new box prop**

Replace the entire `MasterItemDirectory` function (from `export function MasterItemDirectory({` through its closing `}`) with:

```typescript
type SortColumn = "item_code" | "part_no" | "is_active"
type SortDirection = "asc" | "desc"

const PAGE_SIZE = 20

export function MasterItemDirectory({
  boxes,
  masterItems,
  products,
}: {
  boxes: MasterItemBox[]
  masterItems: MasterItem[]
  products: ProductOption[]
}) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all")
  const [sortColumn, setSortColumn] = useState<SortColumn>("item_code")
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc")
  const [page, setPage] = useState(1)

  function toggleSort(column: SortColumn) {
    if (column === sortColumn) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"))
      return
    }
    setSortColumn(column)
    setSortDirection("asc")
    setPage(1)
  }

  const filteredMasterItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("id-ID")

    const filtered = masterItems.filter((masterItem) => {
      const matchesQuery =
        !normalizedQuery ||
        masterItem.item_code
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery) ||
        masterItem.part_no
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery) ||
        masterItem.part_name
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery)
      const matchesStatus =
        status === "all" ||
        (status === "active" ? masterItem.is_active : !masterItem.is_active)

      return matchesQuery && matchesStatus
    })

    const direction = sortDirection === "asc" ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sortColumn === "is_active") {
        return (Number(a.is_active) - Number(b.is_active)) * direction
      }
      return (
        a[sortColumn]
          .toLocaleLowerCase("id-ID")
          .localeCompare(b[sortColumn].toLocaleLowerCase("id-ID"), "id-ID") *
        direction
      )
    })
  }, [masterItems, query, status, sortColumn, sortDirection])

  const pageCount = Math.max(1, Math.ceil(filteredMasterItems.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pagedMasterItems = filteredMasterItems.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  )

  const sortLabels: Record<SortColumn, string> = {
    item_code: "Kode item",
    part_no: "Part No",
    is_active: "Status",
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1 sm:max-w-sm">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2 left-2.5 size-4" />
            <Input
              aria-label="Cari Master Item"
              className="pl-8"
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
              placeholder="Cari kode, Part No, atau nama"
              value={query}
            />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <FilterIcon data-icon="inline-start" />
                Filter
                {status !== "all" ? (
                  <Badge className="ml-1" variant="secondary">
                    1
                  </Badge>
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64">
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground text-xs font-medium">
                  Status
                </p>
                <Select
                  value={status}
                  onValueChange={(value) => {
                    setStatus(value as typeof status)
                    setPage(1)
                  }}
                >
                  <SelectTrigger
                    aria-label="Filter status Master Item"
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua status</SelectItem>
                    <SelectItem value="active">Aktif</SelectItem>
                    <SelectItem value="inactive">Nonaktif</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">
                <ArrowUpDownIcon data-icon="inline-start" />
                Urutkan
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56">
              <div className="flex flex-col gap-1">
                {(Object.keys(sortLabels) as SortColumn[]).map((column) => {
                  const isActive = column === sortColumn
                  const Icon =
                    sortDirection === "asc" ? ArrowUpIcon : ArrowDownIcon
                  return (
                    <Button
                      className="justify-between"
                      key={column}
                      onClick={() => toggleSort(column)}
                      type="button"
                      variant={isActive ? "secondary" : "ghost"}
                    >
                      {sortLabels[column]}
                      {isActive ? <Icon className="size-3.5" /> : null}
                    </Button>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <CreateMasterItemDialog />
      </div>

      {filteredMasterItems.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Tidak ada Master Item</EmptyTitle>
            <EmptyDescription>
              Ubah pencarian/filter atau buat Master Item baru.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No</TableHead>
                <TableHead>Master Item</TableHead>
                <TableHead>Unit / Qty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedMasterItems.map((masterItem, index) => (
                <TableRow key={masterItem.id}>
                  <TableCell>{(currentPage - 1) * PAGE_SIZE + index + 1}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{masterItem.part_no}</span>
                      <span className="text-muted-foreground text-xs">
                        {masterItem.item_code} · {masterItem.part_name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {masterItem.unit} · Qty {masterItem.default_label_qty}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={masterItem.is_active ? "secondary" : "outline"}
                    >
                      {masterItem.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-start gap-2">
                      <EditMasterItemDialog masterItem={masterItem} />
                      <MasterItemBoxLayerEditor
                        boxes={boxes}
                        masterItem={masterItem}
                        products={products}
                      />
                      <MasterItemActiveAction
                        isActive={masterItem.is_active}
                        masterItemId={masterItem.id}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationControls
            currentPage={currentPage}
            onPageChange={setPage}
            pageCount={pageCount}
            totalItems={filteredMasterItems.length}
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Rename the label and remove the sequence field in `MasterItemForm`**

Edit — replace:
```typescript
          <Field>
            <FieldLabel
              htmlFor={
                masterItem
                  ? `defaultLabelQty-${masterItem.id}`
                  : "defaultLabelQty"
              }
            >
              Default label Qty
            </FieldLabel>
```
with:
```typescript
          <Field>
            <FieldLabel
              htmlFor={
                masterItem
                  ? `defaultLabelQty-${masterItem.id}`
                  : "defaultLabelQty"
              }
            >
              Packing Qty
            </FieldLabel>
```

Edit — delete the entire sequence-code `<Field>` block:
```typescript
        <Field>
          <FieldLabel
            htmlFor={
              masterItem
                ? `itemSequenceCode-${masterItem.id}`
                : "itemSequenceCode"
            }
          >
            Kode sequence opsional
          </FieldLabel>
          <Input
            defaultValue={masterItem?.item_sequence_code ?? ""}
            id={
              masterItem
                ? `itemSequenceCode-${masterItem.id}`
                : "itemSequenceCode"
            }
            maxLength={64}
            name="itemSequenceCode"
            placeholder="LINE-A"
          />
          <FieldDescription>
            Metadata saja. Nomor urut tidak akan dibentuk sebelum scope sequence
            disetujui.
          </FieldDescription>
        </Field>
      </FieldGroup>
```
replace with just:
```typescript
      </FieldGroup>
```

Also remove the now-unused `FieldDescription` import if `FieldDescription` is no longer referenced elsewhere in the file (it is not, after this deletion) — edit the import:
```typescript
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
```
to:
```typescript
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
```

- [ ] **Step 4: Commit**

```bash
git add src/features/master-items/components/master-item-directory.tsx
git commit -m "feat: rename Packing Qty label, drop sequence field, add filter/sort/pagination to Master Item list"
```

---

## Task 5: Master Item admin page query rewrite

**Files:**
- Modify: `src/app/admin/master-items/page.tsx`

- [ ] **Step 1: Replace the full file content**

```typescript
import { PackageSearchIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { MasterItemDirectory } from "@/features/master-items/components/master-item-directory"
import { requireAdmin } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function MasterItemsPage() {
  await requireAdmin()
  const supabase = await createClient()
  const [masterItemsResult, productsResult, boxesResult] = await Promise.all([
    supabase
      .from("master_items")
      .select("id, item_code, part_no, part_name, unit, default_label_qty, is_active")
      .order("item_code"),
    supabase
      .from("products")
      .select(
        "id, product_code, part_name, outer_diameter, inner_diameter, length, normalized_dimensions",
      )
      .eq("is_active", true)
      .order("product_code"),
    supabase
      .from("boxes")
      .select(
        "id, master_item_id, box_no, box_code, box_name, box_layers(id, layer_no, layer_name, box_layer_requirements(product_id, expected_qty)), packing_sessions(id)",
      )
      .order("box_no"),
  ])
  const error = masterItemsResult.error ?? productsResult.error ?? boxesResult.error
  const masterItems = masterItemsResult.data ?? []
  const products = (productsResult.data ?? []).map((product) => ({
    id: product.id,
    productCode: product.product_code,
    partName: product.part_name,
    outerDiameter: product.outer_diameter,
    innerDiameter: product.inner_diameter,
    length: product.length,
    normalizedDimensions: product.normalized_dimensions,
  }))
  const boxes = (boxesResult.data ?? []).map((box) => ({
    id: box.id,
    masterItemId: box.master_item_id,
    boxNo: box.box_no,
    boxCode: box.box_code,
    boxName: box.box_name,
    isUsed: box.packing_sessions.length > 0,
    layers: box.box_layers
      .map((layer) => ({
        id: layer.id,
        layerNo: layer.layer_no,
        layerName: layer.layer_name,
        requirements: layer.box_layer_requirements.map((requirement) => ({
          productId: requirement.product_id,
          expectedQty: requirement.expected_qty,
        })),
      }))
      .sort((first, second) => first.layerNo - second.layerNo),
  }))

  return (
    <div className="flex w-full flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Master Item</h1>
        <p className="text-muted-foreground text-sm">
          Part No, unit, dan Packing Qty menjadi sumber data label. Tiap Master
          Item memiliki maksimal 3 Box.
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <PackageSearchIcon />
          <AlertTitle>Data Master Item tidak dapat dimuat</AlertTitle>
          <AlertDescription>
            Periksa koneksi Supabase atau izin admin.
          </AlertDescription>
        </Alert>
      ) : null}

      <MasterItemDirectory boxes={boxes} masterItems={masterItems} products={products} />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/master-items/page.tsx
git commit -m "feat: query nested boxes directly for the Master Item admin page"
```

---

## Task 6: Remove Box admin menu/feature, remove Delivery Number admin route

**Files:**
- Modify: `src/app/admin/layout.tsx`
- Delete: `src/app/admin/boxes/` (entire directory)
- Delete: `src/features/boxes/` (entire directory)
- Delete: `src/app/admin/delivery-numbers/page.tsx`
- Delete: `src/features/delivery-numbers/components/delivery-number-directory.tsx`

- [ ] **Step 1: Edit the sidebar**

In `src/app/admin/layout.tsx`, remove the Box `SidebarMenuItem`:
```typescript
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link href="/admin/boxes">
                      <ContainerIcon />
                      <span>Box</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
```
and remove the Delivery Number `SidebarMenuItem`:
```typescript
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link href="/admin/delivery-numbers">
                      <TruckIcon />
                      <span>Delivery Number</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
```
and drop the now-unused `ContainerIcon` and `TruckIcon` imports from the `lucide-react` import block at the top of the file (leave `Building2Icon`, `BoxesIcon`, `FileSpreadsheetIcon`, `LayoutDashboardIcon`, `Link2Icon`, `PackageSearchIcon`, `ScanLineIcon` — all still used).

- [ ] **Step 2: Delete the old Box feature and route**

```bash
git rm -r src/app/admin/boxes src/features/boxes
```

- [ ] **Step 3: Delete the Delivery Number admin route and directory component**

```bash
git rm src/app/admin/delivery-numbers/page.tsx
git rm src/features/delivery-numbers/components/delivery-number-directory.tsx
```
(`src/features/delivery-numbers/actions.ts`, `validation.ts`, `form-state.ts` stay — they're reused by Task 8/9. If `src/app/admin/delivery-numbers/` is now an empty directory, it is removed automatically by `git rm` once its only file is gone; verify with `ls src/app/admin/delivery-numbers 2>/dev/null` — expect no output.)

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/layout.tsx
git commit -m "feat: remove Box and Delivery Number admin menu items and routes"
```

---

## Task 7: CSV import template — drop item_sequence_code column

**Files:**
- Modify: `src/features/csv-imports/templates.ts`

- [ ] **Step 1: Edit the `masterItems` template**

Replace:
```typescript
  masterItems: {
    databaseType: "master_item",
    label: "Master Item",
    headers: [
      "item_code",
      "part_no",
      "part_name",
      "unit",
      "default_label_qty",
      "item_sequence_code",
    ],
    sample:
      "item_code,part_no,part_name,unit,default_label_qty,item_sequence_code\ndm-0001,3210A-K1Z-NA01-DL,Tube Assy,Pcs,100,\n",
  },
```
with:
```typescript
  masterItems: {
    databaseType: "master_item",
    label: "Master Item",
    headers: ["item_code", "part_no", "part_name", "unit", "default_label_qty"],
    sample:
      "item_code,part_no,part_name,unit,default_label_qty\ndm-0001,3210A-K1Z-NA01-DL,Tube Assy,Pcs,100\n",
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/features/csv-imports/templates.ts
git commit -m "feat: drop item_sequence_code from the Master Item CSV template"
```

---

## Task 8: Delivery Number data layer — operator gate, inline create dialog

**Files:**
- Modify: `src/features/delivery-numbers/actions.ts`
- Modify: `src/features/delivery-numbers/validation.ts`
- Create: `src/features/delivery-numbers/components/create-delivery-number-dialog.tsx`

- [ ] **Step 1: Change the guard in `actions.ts`**

Edit — replace the import:
```typescript
import { requireAdmin } from "@/features/auth/server"
```
with:
```typescript
import { requireOperator } from "@/features/auth/server"
```

Edit — in each of `createDeliveryNumberAction`, `updateDeliveryNumberAction`, `closeOrCancelDeliveryNumberAction`, replace `await requireAdmin()` with `await requireOperator()`.

Edit — change the `revalidatePath` target in all three functions from `"/admin/delivery-numbers"` to `"/scan"`.

- [ ] **Step 2: Update the RPC error mapping in `validation.ts`**

Replace:
```typescript
export function deliveryNumberRpcErrorMessage(message: string): string {
  const messages: Record<string, string> = {
    DELIVERY_NUMBER_ADMIN_REQUIRED:
      "Aksi ini hanya tersedia untuk admin aktif.",
```
with:
```typescript
export function deliveryNumberRpcErrorMessage(message: string): string {
  const messages: Record<string, string> = {
    DELIVERY_NUMBER_FORBIDDEN:
      "Aksi ini hanya tersedia untuk operator atau admin aktif.",
```
(the rest of the `messages` map and the function body stay unchanged.)

- [ ] **Step 3: Create the inline create dialog**

```typescript
"use client"

import { useActionState } from "react"
import { CircleAlertIcon, PlusIcon } from "lucide-react"

import { createDeliveryNumberAction } from "@/features/delivery-numbers/actions"
import { initialDeliveryNumberActionState } from "@/features/delivery-numbers/form-state"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"

export type CreateDeliveryNumberSupplier = {
  id: string
  supplierCode: string
  supplierName: string
}

export function CreateDeliveryNumberDialog({
  suppliers,
}: {
  suppliers: CreateDeliveryNumberSupplier[]
}) {
  const [state, formAction, isPending] = useActionState(
    createDeliveryNumberAction,
    initialDeliveryNumberActionState,
  )
  useActionStateToast(state)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button disabled={suppliers.length === 0} type="button" variant="outline">
          <PlusIcon data-icon="inline-start" />
          Buat Delivery Number
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Buat Delivery Number</DialogTitle>
          <DialogDescription>
            Delivery Number baru langsung berstatus aktif dan siap dipilih.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-5" noValidate>
          <input name="status" type="hidden" value="active" />
          {state.error ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="scan-dn-supplier">Supplier</FieldLabel>
              <Select name="supplierId" required>
                <SelectTrigger className="w-full" id="scan-dn-supplier">
                  <SelectValue placeholder="Pilih supplier aktif" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.supplierCode} — {supplier.supplierName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="scan-dn-number">Delivery Number</FieldLabel>
              <Input
                id="scan-dn-number"
                maxLength={100}
                name="deliveryNumber"
                placeholder="DEV-DN-001"
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="scan-dn-date">Tanggal delivery</FieldLabel>
              <Input id="scan-dn-date" name="deliveryDate" required type="date" />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button disabled={isPending || suppliers.length === 0} type="submit">
              {isPending ? <Spinner data-icon="inline-start" /> : null}
              Buat Delivery Number
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/features/delivery-numbers/actions.ts src/features/delivery-numbers/validation.ts src/features/delivery-numbers/components/create-delivery-number-dialog.tsx
git commit -m "feat: allow operators to manage Delivery Number, add inline create dialog"
```

---

## Task 9: Scan/packing repoint — box_id, no version, inline Delivery Number create

**Files:**
- Modify: `src/app/(operator)/scan/page.tsx`
- Modify: `src/components/operator/packing-scan-console.tsx`
- Modify: `src/features/scan/actions.ts`

- [ ] **Step 1: Rewrite `src/app/(operator)/scan/page.tsx`**

```typescript
import { CircleAlertIcon } from "lucide-react"

import {
  PackingScanConsole,
  type ActivePackingSessionView,
} from "@/components/operator/packing-scan-console"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { requireOperator } from "@/features/auth/server"
import { createClient } from "@/lib/supabase/server"

export default async function ScanPage() {
  const auth = await requireOperator()
  const supabase = await createClient()
  const [
    masterItemsResult,
    boxesResult,
    activeSessionsResult,
    deliveryNumbersResult,
    suppliersResult,
  ] = await Promise.all([
    supabase
      .from("master_items")
      .select("id, item_code, part_no, part_name")
      .eq("is_active", true)
      .order("part_no"),
    supabase
      .from("boxes")
      .select("id, master_item_id, box_no, box_code, box_name"),
    supabase
      .from("packing_sessions")
      .select(
        "id, status, master_item_id, box_id, master_items(part_no, part_name), boxes(box_code, box_name, box_layer_requirements(box_layer_id, expected_qty, sort_order, box_layers(layer_no, layer_name, sort_order))), packing_session_scans(id, box_layer_id, result, error_code, scanned_at)",
      )
      .eq("operator_id", auth.userId)
      .in("status", ["scanning", "ready_to_finalize"])
      .order("started_at", { ascending: false }),
    supabase
      .from("delivery_numbers")
      .select(
        "id, delivery_number, delivery_date, supplier_id, suppliers(supplier_code, supplier_name)",
      )
      .eq("status", "active")
      .order("delivery_number"),
    supabase
      .from("suppliers")
      .select("id, supplier_code, supplier_name")
      .eq("is_active", true)
      .order("supplier_code"),
  ])

  const dataError =
    masterItemsResult.error ??
    boxesResult.error ??
    activeSessionsResult.error ??
    deliveryNumbersResult.error ??
    suppliersResult.error
  const boxesByMasterItem = boxesResult.data ?? []
  const masterItems = (masterItemsResult.data ?? [])
    .filter((item) =>
      boxesByMasterItem.some((box) => box.master_item_id === item.id),
    )
    .map((item) => ({
      id: item.id,
      itemCode: item.item_code,
      partName: item.part_name,
      partNo: item.part_no,
    }))
  const boxes = boxesByMasterItem.map((box) => ({
    id: box.id,
    masterItemId: box.master_item_id,
    boxCode: box.box_code,
    boxName: box.box_name,
  }))
  const activeSessions = (activeSessionsResult.data ?? [])
    .map(toActivePackingSession)
    .filter((session): session is ActivePackingSessionView => session !== null)
  const deliveryNumbers = (deliveryNumbersResult.data ?? [])
    .filter(
      (deliveryNumber): deliveryNumber is DeliveryNumberQuery & {
        suppliers: NonNullable<DeliveryNumberQuery["suppliers"]>
      } => deliveryNumber.suppliers !== null,
    )
    .map((deliveryNumber) => ({
      id: deliveryNumber.id,
      deliveryDate: deliveryNumber.delivery_date,
      deliveryNumber: deliveryNumber.delivery_number,
      supplierCode: deliveryNumber.suppliers.supplier_code,
      supplierId: deliveryNumber.supplier_id,
      supplierName: deliveryNumber.suppliers.supplier_name,
    }))
    .sort(
      (left, right) =>
        left.supplierCode.localeCompare(right.supplierCode) ||
        left.deliveryNumber.localeCompare(right.deliveryNumber),
    )
  const suppliers = (suppliersResult.data ?? []).map((supplier) => ({
    id: supplier.id,
    supplierCode: supplier.supplier_code,
    supplierName: supplier.supplier_name,
  }))

  return (
    <div className="flex w-full flex-col gap-6">
      {dataError ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Data scan tidak dapat dimuat</AlertTitle>
          <AlertDescription>
            Periksa koneksi Supabase atau izin operator.
          </AlertDescription>
        </Alert>
      ) : null}
      <PackingScanConsole
        activeSessions={activeSessions}
        boxes={boxes}
        deliveryNumbers={deliveryNumbers}
        masterItems={masterItems}
        suppliers={suppliers}
      />
    </div>
  )
}

type DeliveryNumberQuery = {
  delivery_date: string
  delivery_number: string
  id: string
  supplier_id: string
  suppliers: { supplier_code: string; supplier_name: string } | null
}

type ActiveSessionQuery = {
  id: string
  status: string
  master_items: { part_name: string; part_no: string } | null
  boxes: {
    box_code: string
    box_name: string
    box_layer_requirements: Array<{
      box_layer_id: string
      expected_qty: number
      sort_order: number
      box_layers: { layer_no: number; layer_name: string; sort_order: number } | null
    }>
  } | null
  packing_session_scans: Array<{
    box_layer_id: string | null
    error_code: string | null
    id: string
    result: "accepted" | "duplicate" | "invalid" | "over_qty"
    scanned_at: string
  }>
}

function toActivePackingSession(
  session: ActiveSessionQuery | null,
): ActivePackingSessionView | null {
  if (!session?.master_items || !session.boxes) return null

  const layersById = new Map<
    string,
    { id: string; layerNo: number; layerName: string; sortOrder: number; expectedQty: number }
  >()

  for (const requirement of session.boxes.box_layer_requirements) {
    if (!requirement.box_layers) continue
    const existing = layersById.get(requirement.box_layer_id)
    if (existing) {
      existing.expectedQty += requirement.expected_qty
    } else {
      layersById.set(requirement.box_layer_id, {
        id: requirement.box_layer_id,
        layerNo: requirement.box_layers.layer_no,
        layerName: requirement.box_layers.layer_name,
        sortOrder: requirement.box_layers.sort_order,
        expectedQty: requirement.expected_qty,
      })
    }
  }

  const layers = [...layersById.values()]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((layer) => {
      const acceptedQty = session.packing_session_scans.filter(
        (scan) => scan.result === "accepted" && scan.box_layer_id === layer.id,
      ).length

      return {
        id: layer.id,
        layerNo: layer.layerNo,
        layerName: layer.layerName,
        expectedQty: layer.expectedQty,
        acceptedQty,
      }
    })
  const totalExpectedQty = layers.reduce((total, layer) => total + layer.expectedQty, 0)
  const acceptedQty = layers.reduce((total, layer) => total + layer.acceptedQty, 0)

  return {
    id: session.id,
    status: session.status,
    masterItemPartNo: session.master_items.part_no,
    masterItemName: session.master_items.part_name,
    boxCode: session.boxes.box_code,
    boxName: session.boxes.box_name,
    acceptedQty,
    totalExpectedQty,
    layers,
    recentScans: [...session.packing_session_scans]
      .sort(
        (left, right) =>
          new Date(right.scanned_at).getTime() - new Date(left.scanned_at).getTime(),
      )
      .slice(0, 5)
      .map((scan) => ({
        id: scan.id,
        result: scan.result,
        errorCode: scan.error_code,
        scannedAt: scan.scanned_at,
      })),
  }
}
```

- [ ] **Step 2: Update `src/features/scan/actions.ts`**

Edit — in `startPackingSessionAction`, replace:
```typescript
  const masterItemId = valueFromFormData(formData, "masterItemId")
  const masterItemBoxId = valueFromFormData(formData, "boxDefinitionId")

  if (
    !masterItemId ||
    !masterItemBoxId ||
    !uuidPattern.test(masterItemId) ||
    !uuidPattern.test(masterItemBoxId)
  ) {
    return { error: "Master Item dan Box wajib dipilih." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("start_packing_session", {
    p_master_item_box_id: masterItemBoxId,
    p_master_item_id: masterItemId,
  })
```
with:
```typescript
  const masterItemId = valueFromFormData(formData, "masterItemId")
  const boxId = valueFromFormData(formData, "boxId")

  if (
    !masterItemId ||
    !boxId ||
    !uuidPattern.test(masterItemId) ||
    !uuidPattern.test(boxId)
  ) {
    return { error: "Master Item dan Box wajib dipilih." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("start_packing_session", {
    p_box_id: boxId,
    p_master_item_id: masterItemId,
  })
```

Edit — also update the safe error map: replace
```typescript
  MASTER_ITEM_BOX_NOT_ACTIVE_OR_MISMATCH:
    "Assignment box sudah tidak aktif atau tidak sesuai dengan Master Item.",
  MASTER_ITEM_BOX_EMPTY: "Assignment box ini belum punya requirement produk.",
```
with:
```typescript
  BOX_NOT_FOUND_OR_MISMATCH: "Box tidak ditemukan atau tidak sesuai dengan Master Item.",
  BOX_EMPTY: "Box ini belum punya requirement produk.",
```

- [ ] **Step 3: Rewrite `src/components/operator/packing-scan-console.tsx`**

Apply these edits to the existing file (do not paste a brand-new file — the scanner/finalize/print wiring in the second half is unchanged):

Edit — replace the type exports block:
```typescript
export type ScanBoxDefinitionOption = {
  boxCode: string
  boxName: string
  id: string
  masterItemId: string
  version: number
}
```
with:
```typescript
export type ScanBoxOption = {
  boxCode: string
  boxName: string
  id: string
  masterItemId: string
}
```

Edit — replace:
```typescript
export type ActivePackingSessionView = {
  acceptedQty: number
  boxCode: string
  boxName: string
  id: string
  layers: ScanLayerProgress[]
  masterItemName: string
  masterItemPartNo: string
  recentScans: RecentScan[]
  status: string
  totalExpectedQty: number
  version: number
}
```
with:
```typescript
export type ActivePackingSessionView = {
  acceptedQty: number
  boxCode: string
  boxName: string
  id: string
  layers: ScanLayerProgress[]
  masterItemName: string
  masterItemPartNo: string
  recentScans: RecentScan[]
  status: string
  totalExpectedQty: number
}
```

Edit — add the `CreateDeliveryNumberDialog` import and its supplier type alongside the existing imports:
```typescript
import {
  CreateDeliveryNumberDialog,
  type CreateDeliveryNumberSupplier,
} from "@/features/delivery-numbers/components/create-delivery-number-dialog"
```

Edit — in `StartSessionForm`, rename the prop `allowedBoxes: ScanBoxDefinitionOption[]` to `allowedBoxes: ScanBoxOption[]`, rename hidden input `name="boxDefinitionId"` to `name="boxId"`, and drop the `(v{boxDefinition.version})` text from the `SelectItem` label:
```typescript
                  {allowedBoxes.map((boxDefinition) => (
                    <SelectItem key={boxDefinition.id} value={boxDefinition.id}>
                      {boxDefinition.boxCode} · {boxDefinition.boxName} (v
                      {boxDefinition.version})
                    </SelectItem>
                  ))}
```
becomes:
```typescript
                  {allowedBoxes.map((boxDefinition) => (
                    <SelectItem key={boxDefinition.id} value={boxDefinition.id}>
                      {boxDefinition.boxCode} · {boxDefinition.boxName}
                    </SelectItem>
                  ))}
```
and the label text `Box Definition` stays as-is (it's just a heading — no functional dependency).

Edit — the `SessionListView` and detail header both interpolate `v{session.version}`. Remove that fragment in both places:
```typescript
                  <p className="text-muted-foreground text-sm">
                    {session.masterItemName} · {session.boxCode} ·{" "}
                    {session.boxName} v{session.version}
                  </p>
```
becomes:
```typescript
                  <p className="text-muted-foreground text-sm">
                    {session.masterItemName} · {session.boxCode} · {session.boxName}
                  </p>
```
and:
```typescript
            <p className="text-muted-foreground text-sm">
              {activeSession.masterItemName} · {activeSession.boxCode} ·{" "}
              {activeSession.boxName} v{activeSession.version}
            </p>
```
becomes:
```typescript
            <p className="text-muted-foreground text-sm">
              {activeSession.masterItemName} · {activeSession.boxCode} · {activeSession.boxName}
            </p>
```

Edit — `PackingScanConsole`'s props: replace
```typescript
export function PackingScanConsole({
  activeSessions,
  boxDefinitions,
  deliveryNumbers,
  masterItems,
}: {
  activeSessions: ActivePackingSessionView[]
  boxDefinitions: ScanBoxDefinitionOption[]
  deliveryNumbers: DeliveryNumberOption[]
  masterItems: ScanMasterItemOption[]
}) {
```
with:
```typescript
export function PackingScanConsole({
  activeSessions,
  boxes,
  deliveryNumbers,
  masterItems,
  suppliers,
}: {
  activeSessions: ActivePackingSessionView[]
  boxes: ScanBoxOption[]
  deliveryNumbers: DeliveryNumberOption[]
  masterItems: ScanMasterItemOption[]
  suppliers: CreateDeliveryNumberSupplier[]
}) {
```

Edit — inside the function body, rename the local var and its two usages:
```typescript
  const allowedBoxes = useMemo(
    () =>
      boxDefinitions.filter(
        (boxDefinition) => boxDefinition.masterItemId === selectedMasterItemId,
      ),
    [boxDefinitions, selectedMasterItemId],
  )
```
becomes:
```typescript
  const allowedBoxes = useMemo(
    () =>
      boxes.filter(
        (boxDefinition) => boxDefinition.masterItemId === selectedMasterItemId,
      ),
    [boxes, selectedMasterItemId],
  )
```
and the two `<StartSessionForm allowedBoxes={allowedBoxes} .../>` call sites stay unchanged (they already reference the local `allowedBoxes`).

Edit — add the `CreateDeliveryNumberDialog` next to the existing Delivery Number picker inside the finalize `<FieldGroup>`. Replace:
```typescript
                <Field>
                  <FieldLabel htmlFor="finalize-dn-search">
                    Cari Delivery Number
                  </FieldLabel>
```
with:
```typescript
                <div className="flex items-center justify-between gap-3">
                  <p className="text-muted-foreground text-sm">
                    Pilih Delivery Number aktif, atau buat baru.
                  </p>
                  <CreateDeliveryNumberDialog suppliers={suppliers} />
                </div>
                <Field>
                  <FieldLabel htmlFor="finalize-dn-search">
                    Cari Delivery Number
                  </FieldLabel>
```

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: zero errors (this is the last piece wiring everything together; if Tasks 1–8 all landed correctly, this should be fully green now).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(operator)/scan/page.tsx" src/components/operator/packing-scan-console.tsx src/features/scan/actions.ts
git commit -m "feat: repoint Scan console to box_id, drop version display, add inline Delivery Number create"
```

---

## Task 10: Verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 2: Lint**

```bash
npm run lint
```
Expected: no errors. Fix any unused-import warnings left over from the edits above (e.g. dropped `FieldDescription`, `ContainerIcon`, `TruckIcon`).

- [ ] **Step 3: Unit tests**

```bash
npm run test
```
Expected: all pass, including the new `src/features/master-items/validation.test.ts` and the deleted `src/features/boxes/validation.test.ts` no longer being collected.

- [ ] **Step 4: pgTAP suite**

```bash
npx supabase test db
```
Expected: all pass (re-run in case Task 1's own verification step was done before later tasks revealed a mismatch).

- [ ] **Step 5: Manual smoke test in the browser**

Start the dev server and walk through:
1. `/admin/master-items` — create a Master Item, confirm "Packing Qty" label and no sequence field, confirm filter/sort/pagination controls appear next to search.
2. Open "Kelola Box" on that Master Item — add 3 Boxes (confirm the 4th is blocked), add layers to Box 1 (confirm layer names read "Box 1 - Layer 1", "Box 1 - Layer 2", ...), add product requirements, save.
3. Confirm the sidebar no longer shows "Box" or "Delivery Number".
4. `/scan` — confirm a Delivery Number can be created inline, and a packing session can be started against one of the new Boxes.

Report back what was tested and any issue found; fix inline and re-verify before considering this task done.

- [ ] **Step 6: Final status check**

```bash
git status
git log --oneline -12
```
Expected: clean working tree, one commit per task above.
