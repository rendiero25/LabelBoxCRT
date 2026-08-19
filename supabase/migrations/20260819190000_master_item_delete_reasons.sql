-- Penolakan hapus Master Item menyebutkan sebabnya, dan Master Item yang belum
-- pernah dipakai kirim benar-benar bisa dihapus.
--
-- Sebelumnya delete_master_item hanya menangkap pelanggaran foreign key apa pun
-- dan melaporkannya sebagai MASTER_ITEM_IN_USE -- kode yang sama dengan
-- penolakan sunting, sehingga pesannya di layar berbunyi "batch label box yang
-- belum ditutup" walaupun seluruh batchnya sudah ditutup dan yang sebenarnya
-- menahan adalah Box Definition atau product mapping. Admin karena itu mencari
-- batch terbuka yang tidak pernah ada.
--
-- Sekarang riwayat kiriman dan definisi dibedakan:
--
--   * Ada batch label box atau packing session -> ditolak dengan
--     MASTER_ITEM_HAS_HISTORY. Riwayatnya memang harus tetap tersimpan; yang
--     dipakai untuk menghentikan pemakaian baru adalah Nonaktifkan.
--   * Tidak ada riwayat -> Box Definition beserta layer dan kebutuhan
--     produknya, juga product mapping-nya, ikut terhapus. Ketiganya milik
--     Master Item itu sendiri dan tidak berarti apa-apa tanpa dia; menuntut
--     admin membersihkannya satu per satu hanya memindahkan pekerjaan yang
--     sama ke tangan manusia.

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
  where id = p_master_item_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_FOUND';
  end if;

  select count(*)::integer into batch_count
  from public.label_box_batches batch
  where batch.master_item_id = p_master_item_id;

  select count(*)::integer into session_count
  from public.packing_sessions session
  where session.master_item_id = p_master_item_id;

  if batch_count > 0 or session_count > 0 then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_HAS_HISTORY';
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
      'boxes_removed', box_count,
      'product_mappings_removed', mapping_count
    )
  );
end;
$$;

notify pgrst, 'reload schema';
