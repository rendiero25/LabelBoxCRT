-- Hapus Master Item ikut menunggu pekerjaan yang sedang berjalan.
--
-- delete_master_item hanya menghitung ada tidaknya riwayat untuk memilih antara
-- menghapus betulan dan menandai terhapus; batch yang masih terbuka atau sesi
-- packing yang masih berjalan sama-sama terhitung sebagai "ada riwayat",
-- sehingga Master Item bisa hilang dari daftar di tengah kiriman yang belum
-- selesai. Syaratnya kini sama dengan syarat menyunting: yang masih berjalan
-- menahan, yang sudah selesai tidak.

create or replace function public.delete_master_item(
  p_master_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_code text;
  batch_count integer;
  session_count integer;
  box_count integer;
  mapping_count integer;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  select item_code into target_code
  from public.master_items
  where id = p_master_item_id and deleted_at is null;

  if not found then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_FOUND';
  end if;

  -- Pekerjaan yang masih berjalan menahan penghapusan, sama seperti menahan
  -- penyuntingan: box yang belum diverifikasi atau belum dicetak masih akan
  -- membaca Master Item ini, dan menghilangkannya dari daftar di tengah jalan
  -- membuat operator kehilangan barang yang sedang dikerjakannya.
  if exists (
    select 1 from public.label_box_batches batch
    where batch.master_item_id = p_master_item_id
      and batch.closed_at is null
  ) or exists (
    select 1 from public.packing_sessions session
    where session.master_item_id = p_master_item_id
      and session.status not in ('confirmed', 'cancelled', 'expired')
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_IN_USE';
  end if;

  select count(*)::integer into batch_count
  from public.label_box_batches batch
  where batch.master_item_id = p_master_item_id;

  select count(*)::integer into session_count
  from public.packing_sessions session
  where session.master_item_id = p_master_item_id;

  -- Riwayat kiriman: barisnya ditahan sebagai jangkar, tetapi ditandai
  -- terhapus dan dinonaktifkan sekaligus supaya tidak bisa dipakai batch baru
  -- lewat jalur mana pun yang masih menyaring is_active.
  if batch_count > 0 or session_count > 0 then
    update public.master_items
    set deleted_at = now(),
        deleted_by = auth.uid(),
        is_active = false
    where id = p_master_item_id;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      auth.uid(), 'master_item.deleted', 'master_item', p_master_item_id::text,
      jsonb_build_object(
        'item_code', target_code,
        'mode', 'archived',
        'label_box_batches', batch_count,
        'packing_sessions', session_count
      )
    );

    return;
  end if;

  select count(*)::integer into box_count
  from public.boxes box
  where box.master_item_id = p_master_item_id;

  select count(*)::integer into mapping_count
  from public.master_item_products mapping
  where mapping.master_item_id = p_master_item_id;

  delete from public.box_layer_requirements requirement
  where requirement.box_layer_id in (
    select layer.id
    from public.box_layers layer
    join public.boxes box on box.id = layer.box_id
    where box.master_item_id = p_master_item_id
  );

  delete from public.box_layers layer
  where layer.box_id in (
    select box.id from public.boxes box
    where box.master_item_id = p_master_item_id
  );

  delete from public.boxes box
  where box.master_item_id = p_master_item_id;

  delete from public.master_item_products mapping
  where mapping.master_item_id = p_master_item_id;

  begin
    delete from public.master_items where id = p_master_item_id;
  exception when foreign_key_violation then
    -- Jaring terakhir untuk tabel baru yang menunjuk master_items dan belum
    -- terpikirkan di sini; lebih baik menolak daripada menghapus separuh.
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_IN_USE';
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'master_item.deleted', 'master_item', p_master_item_id::text,
    jsonb_build_object(
      'item_code', target_code,
      'mode', 'removed',
      'boxes_removed', box_count,
      'product_mappings_removed', mapping_count
    )
  );
end;
$$;

notify pgrst, 'reload schema';
