-- Box code auto-generation: "Kode box" on the admin Box form becomes system-
-- generated and non-editable, in both create and edit. Format: 'box-' + a
-- 2-digit zero-padded sequential number starting at box-01; once the counter
-- passes 99 the number widens without re-padding (box-100, box-101, ...).
-- Same dedicated-sequence pattern as print_job_sequence in
-- finalize_packing_session, for atomicity/uniqueness under concurrent
-- creates.

create sequence public.box_code_seq start with 1;

-- Backfill existing boxes in creation order so today's three boxes become
-- box-01/box-02/box-03 in the order they were created.
do $$
declare
  target record;
begin
  for target in select id from public.boxes order by created_at, id loop
    update public.boxes
    set box_code = 'box-' || lpad(nextval('public.box_code_seq')::text, 2, '0')
    where id = target.id;
  end loop;
end;
$$;

-- create_box: drop p_box_code, generate it internally.
drop function if exists public.create_box(text, text, jsonb);

create or replace function public.create_box(
  p_box_name text,
  p_layers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_box_name text := btrim(p_box_name);
  generated_box_code text;
  target_box_id uuid;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'BOX_ADMIN_REQUIRED';
  end if;

  if normalized_box_name = '' or char_length(normalized_box_name) > 200 then
    raise exception using errcode = 'P0001', message = 'BOX_INPUT_INVALID';
  end if;

  perform private.validate_box_layers_payload(p_layers);

  generated_box_code := 'box-' || lpad(nextval('public.box_code_seq')::text, 2, '0');

  begin
    insert into public.boxes (box_code, box_name)
    values (generated_box_code, normalized_box_name)
    returning id into target_box_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'BOX_CODE_EXISTS';
  end;

  perform private.persist_box_layers(target_box_id, p_layers);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'box.created', 'box', target_box_id::text,
    jsonb_build_object('box_code', generated_box_code)
  );

  return target_box_id;
end;
$$;

-- update_box: drop p_box_code entirely; box_code is immutable after create.
drop function if exists public.update_box(uuid, text, text, jsonb);

create or replace function public.update_box(
  p_box_id uuid,
  p_box_name text,
  p_layers jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_box_name text := btrim(p_box_name);
  box_in_use boolean;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'BOX_ADMIN_REQUIRED';
  end if;

  if normalized_box_name = '' or char_length(normalized_box_name) > 200 then
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
  -- their per-layer product assignments. Lock layers, but name stays
  -- editable while box_id-in-use.
  if not box_in_use then
    perform private.validate_box_layers_payload(p_layers);
  end if;

  update public.boxes
  set box_name = normalized_box_name
  where id = p_box_id;

  if not box_in_use then
    delete from public.box_layers where box_id = p_box_id;
    perform private.persist_box_layers(p_box_id, p_layers);
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'box.updated', 'box', p_box_id::text,
    jsonb_build_object('layers_locked', box_in_use)
  );

  return p_box_id;
end;
$$;

revoke execute on function public.create_box(text, jsonb) from public, anon;
revoke execute on function public.update_box(uuid, text, jsonb) from public, anon;

grant execute on function public.create_box(text, jsonb) to authenticated;
grant execute on function public.update_box(uuid, text, jsonb) to authenticated;
