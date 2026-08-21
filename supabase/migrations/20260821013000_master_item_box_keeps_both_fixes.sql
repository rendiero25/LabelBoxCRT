-- create_master_item_box memakai dua perbaikan sekaligus.
--
-- Dua migrasi bertetangga menyentuh fungsi yang sama pada hari yang sama, dan
-- yang belakangan menang utuh:
--
--   20260821011651_master_item_deleted_stays_deleted.sql
--     menambah `item.deleted_at is null` pada pemeriksaan Master Item.
--   20260821011700_box_code_widens_past_99.sql
--     mengganti lpad(..., 2, '0') yang memotong kode box setelah box-99.
--
-- Karena keduanya menulis ulang seluruh badan fungsi, yang kedua menghapus
-- kembali filter deleted_at milik yang pertama. Migrasi ini menuliskan versi
-- yang membawa keduanya, supaya urutan replay dari nol pun berakhir di
-- definisi yang benar.
--
-- Tidak ada aturan baru di sini: Master Item terhapus tetap bukan tempat
-- menggantung Box Definition baru, dan kode box tetap melebar apa adanya
-- lewat box-99.

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
  next_code_number text;
  generated_box_code text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_BOX_ADMIN_REQUIRED';
  end if;

  if not exists (
    select 1 from public.master_items item
    where item.id = p_master_item_id
      and item.is_active
      and item.deleted_at is null
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

  next_code_number := nextval('public.box_code_seq')::text;

  -- greatest(2, length(...)) memberi lebar minimum dua digit tanpa pernah
  -- memotong: satu digit dipad jadi '05', tiga digit dibiarkan '100'.
  generated_box_code := 'box-' || lpad(
    next_code_number, greatest(2, length(next_code_number)), '0'
  );

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

notify pgrst, 'reload schema';
