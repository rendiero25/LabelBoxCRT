-- Cakupan produk verifikasi (2026-07-30-verification-product-coverage-design.md).
--
-- Batch hanya boleh ditutup bila setiap produk yang DIMINTA BOX BATCH (lewat
-- box_layer_requirements, bukan master_item_products) pernah punya scan
-- diterima pada sesi milik batch itu. Produk yang terpetakan ke Master Item
-- tetapi tidak diminta layer box mana pun akan selalu ditolak
-- accept_packing_scan, jadi memakai master_item_products sebagai syarat akan
-- mengunci batch selamanya. Penjaga ditaruh setelah pemeriksaan
-- LABEL_BOX_BATCH_ALREADY_CLOSED dan sebelum backfill sesi + stempel
-- closed_at, supaya batch yang belum lengkap tidak sempat mengubah state
-- apa pun.

CREATE OR REPLACE FUNCTION public.close_label_box_batch(p_batch_id uuid)
 RETURNS TABLE(batch_id uuid, closed_at timestamp with time zone, verified_count integer, label_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_batch public.label_box_batches%rowtype;
  pending_box public.label_boxes%rowtype;
  created_session public.packing_sessions%rowtype;
  closed_stamp timestamptz := statement_timestamp();
begin
  if not private.is_active_app_user() then
    raise exception using errcode = 'P0001', message = 'ACTIVE_USER_REQUIRED';
  end if;

  select * into target_batch
  from public.label_box_batches batch
  where batch.id = p_batch_id
  for update;

  if target_batch.id is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_NOT_FOUND';
  end if;

  if target_batch.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_ALREADY_CLOSED';
  end if;

  -- Produk yang diminta box batch berasal dari box_layer_requirements, bukan
  -- master_item_products: produk yang terpetakan ke Master Item tetapi tidak
  -- diminta layer box mana pun akan selalu ditolak accept_packing_scan,
  -- sehingga memakainya sebagai syarat akan mengunci batch selamanya.
  if exists (
    select requirement.product_id
    from public.box_layer_requirements requirement
    join public.box_layers layer on layer.id = requirement.box_layer_id
    join public.label_boxes box on box.box_id = layer.box_id
    where box.batch_id = p_batch_id
    except
    select scan.product_id
    from public.label_boxes box
    join public.packing_session_scans scan
      on scan.packing_session_id = box.packing_session_id
      and scan.result = 'accepted'
    where box.batch_id = p_batch_id
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_PRODUCTS_INCOMPLETE';
  end if;

  -- print_jobs.packing_session_id wajib terisi, sedangkan box yang tidak
  -- pernah discan belum punya sesi. Lengkapi di sini supaya semua label
  -- tetap bisa dicetak apa adanya.
  for pending_box in
    select * from public.label_boxes box
    where box.batch_id = p_batch_id and box.packing_session_id is null
    order by box.set_no, box.box_no
  loop
    insert into public.packing_sessions (
      operator_id, master_item_id, box_id, delivery_number_id,
      qty_delivery, lot_no, status
    ) values (
      auth.uid(), target_batch.master_item_id, pending_box.box_id,
      target_batch.delivery_number_id, target_batch.qty_delivery,
      target_batch.lot_no, 'scanning'
    )
    returning * into created_session;

    update public.label_boxes box
    set packing_session_id = created_session.id
    where box.id = pending_box.id;
  end loop;

  update public.label_box_batches batch
  set closed_at = closed_stamp, closed_by = auth.uid()
  where batch.id = p_batch_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.closed', 'label_box_batch', p_batch_id::text,
    jsonb_build_object(
      'verified_count', (
        select count(*) from public.label_boxes box
        where box.batch_id = p_batch_id and box.status = 'verified'
      ),
      'label_count', target_batch.label_count
    )
  );

  return query
  select
    p_batch_id,
    closed_stamp,
    (
      select count(*)::integer from public.label_boxes box
      where box.batch_id = p_batch_id and box.status = 'verified'
    ),
    target_batch.label_count;
end;
$function$;

notify pgrst, 'reload schema';
