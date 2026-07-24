-- delete_box never deleted box_layers before deleting the box row. Since
-- 20260721090000_restructure_box_master_data.sql added
-- box_layers.box_id references public.boxes (id) on delete restrict, every
-- box (which always has at least one layer) hit foreign_key_violation on
-- delete regardless of master_item usage, and the generic catch mapped it
-- to BOX_IN_USE -- so admins saw "dipakai Master Item" even for boxes with
-- zero master_item_boxes rows. Check real usage explicitly, and clean up
-- the box's own layers (and any orphan requirements on them) before
-- deleting the box when it is genuinely unused.

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
  box_in_use boolean;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'BOX_ADMIN_REQUIRED';
  end if;

  select box_code into target_code from public.boxes where id = p_box_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'BOX_NOT_FOUND';
  end if;

  select exists (
    select 1 from public.master_item_boxes where box_id = p_box_id
  ) into box_in_use;

  if box_in_use then
    raise exception using errcode = 'P0001', message = 'BOX_IN_USE';
  end if;

  delete from public.box_layer_requirements
  where box_layer_id in (select id from public.box_layers where box_id = p_box_id);

  delete from public.box_layers where box_id = p_box_id;

  begin
    delete from public.boxes where id = p_box_id;
  exception when foreign_key_violation then
    raise exception using errcode = 'P0001', message = 'BOX_IN_USE';
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'box.deleted', 'box', p_box_id::text, jsonb_build_object('box_code', target_code));
end;
$$;
