-- Nomor box kembali ditulis nomor box lebih dulu, lalu nomor set dua digit:
-- B101, B201, B301 untuk set pertama, lalu B102, B202, B302 untuk set kedua.
--
-- Migrasi 20260804100000 membaliknya jadi set-dulu ('B' + set + box dua digit)
-- supaya satu set terbaca runtut di tangan operator. Di lapangan yang dipakai
-- justru urutan sebaliknya: label ditempel per posisi box, bukan per set, jadi
-- nomor box yang harus berdiri di depan.
--
-- Batch lama tidak disentuh: box_number dan qr_payload-nya sudah tercetak di
-- label fisik, jadi mengubahnya akan membuat QR tidak cocok dengan kertas
-- yang sudah menempel di box.

CREATE OR REPLACE FUNCTION public.create_label_box_batch(p_supplier_id uuid, p_delivery_number text, p_delivery_date date, p_master_item_id uuid, p_qty_delivery integer, p_lot_no text)
 RETURNS TABLE(batch_id uuid, delivery_number text, delivery_date date, supplier_code text, item_code text, master_item_row_no integer, packing_qty integer, qty_delivery integer, lot_no text, label_count integer, qr_generated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_item public.master_items%rowtype;
  target_supplier public.suppliers%rowtype;
  target_dn public.delivery_numbers%rowtype;
  created_batch public.label_box_batches%rowtype;
  normalized_lot_no text := btrim(coalesce(p_lot_no, ''));
  normalized_dn text := btrim(coalesce(p_delivery_number, ''));
  box_count integer;
  set_count integer;
  computed_row_no integer;
  generated_at timestamptz := statement_timestamp();
begin
  if not private.is_active_app_user() then
    raise exception using errcode = 'P0001', message = 'ACTIVE_USER_REQUIRED';
  end if;

  select * into target_supplier
  from public.suppliers supplier
  where supplier.id = p_supplier_id and supplier.is_active;

  if target_supplier.id is null then
    raise exception using errcode = 'P0001', message = 'SUPPLIER_INVALID';
  end if;

  select * into target_item
  from public.master_items item
  where item.id = p_master_item_id and item.is_active;

  if target_item.id is null then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_ACTIVE';
  end if;

  -- Master Item bersupplier hanya boleh dipakai untuk supplier itu.
  -- Baris lama dengan supplier_id null dibiarkan bebas.
  if target_item.supplier_id is not null
    and target_item.supplier_id <> p_supplier_id then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_SUPPLIER_MISMATCH';
  end if;

  if p_delivery_date is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_DATE_INVALID';
  end if;

  if normalized_dn = '' or char_length(normalized_dn) > 100 then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  if normalized_lot_no = '' or char_length(normalized_lot_no) > 100 then
    raise exception using errcode = 'P0001', message = 'LOT_NO_INVALID';
  end if;

  select count(*)::integer into box_count
  from public.boxes box
  where box.master_item_id = p_master_item_id;

  if box_count = 0 then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_HAS_NO_BOX';
  end if;

  if p_qty_delivery is null or p_qty_delivery < 1
    or target_item.default_label_qty < 1 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_INVALID';
  end if;

  if p_qty_delivery % target_item.default_label_qty <> 0 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_NOT_MULTIPLE';
  end if;

  set_count := p_qty_delivery / target_item.default_label_qty;

  -- Nomor set dicetak 2 digit (B101..B199), jadi lebih dari 99 set tidak
  -- punya representasi nomor box yang unik.
  if set_count > 99 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_INVALID';
  end if;

  select * into target_dn
  from public.delivery_numbers dn
  where dn.supplier_id = p_supplier_id
    and lower(btrim(dn.delivery_number)) = lower(normalized_dn);

  if target_dn.id is null then
    begin
      insert into public.delivery_numbers (
        supplier_id, delivery_number, delivery_date, status, created_by
      ) values (
        p_supplier_id, normalized_dn, p_delivery_date, 'active', auth.uid()
      )
      returning * into target_dn;

      insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
      values (
        auth.uid(), 'delivery_number.created', 'delivery_number', target_dn.id::text,
        jsonb_build_object(
          'supplier_id', target_dn.supplier_id,
          'delivery_number', target_dn.delivery_number,
          'delivery_date', target_dn.delivery_date,
          'status', target_dn.status,
          'source', 'label_box_batch'
        )
      );
    exception when unique_violation then
      -- Operator lain menyisipkan nomor yang sama sepersekian detik lebih
      -- dulu. Ambil barisnya dan perlakukan sebagai pemakaian ulang.
      select * into target_dn
      from public.delivery_numbers dn
      where dn.supplier_id = p_supplier_id
        and lower(btrim(dn.delivery_number)) = lower(normalized_dn);
    end;
  end if;

  if target_dn.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  -- Admin bisa menutup atau membatalkan DN kapan saja; label tidak boleh
  -- dibuat terhadap DN yang sudah tidak aktif.
  if target_dn.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_NOT_ACTIVE';
  end if;

  if target_dn.delivery_date <> p_delivery_date then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_DATE_MISMATCH';
  end if;

  -- Nomor urut master item = posisi barisnya di tabel master item (urut
  -- item_code, sama dengan halaman admin). Disnapshot ke batch supaya label
  -- yang sudah tercetak tidak berubah ketika ada master item dihapus.
  select ranked.position into computed_row_no
  from (
    select item.id, (row_number() over (order by item.item_code))::integer as position
    from public.master_items item
  ) ranked
  where ranked.id = p_master_item_id;

  insert into public.label_box_batches (
    delivery_number_id, supplier_id, master_item_id, master_item_row_no,
    packing_qty, qty_delivery, lot_no, label_count, qr_generated_at, created_by,
    supplier_code_snapshot, item_code_snapshot, part_no_snapshot,
    delivery_number_snapshot, delivery_date_snapshot
  ) values (
    target_dn.id, p_supplier_id, p_master_item_id, computed_row_no,
    target_item.default_label_qty, p_qty_delivery, normalized_lot_no,
    set_count * box_count, generated_at, auth.uid(),
    target_supplier.supplier_code, target_item.item_code, target_item.part_no,
    target_dn.delivery_number, target_dn.delivery_date
  )
  returning * into created_batch;

  insert into public.label_boxes (
    batch_id, box_id, box_no, set_no, box_number, qr_payload
  )
  select
    created_batch.id,
    box.id,
    box.box_no,
    series.set_no,
    'B' || box.box_no::text || lpad(series.set_no::text, 2, '0'),
    concat_ws(
      '|',
      target_supplier.supplier_code,
      target_item.part_no,
      target_item.default_label_qty::text,
      computed_row_no::text,
      normalized_lot_no,
      'B' || box.box_no::text || lpad(series.set_no::text, 2, '0'),
      to_char(target_dn.delivery_date, 'DD-MM-YYYY')
    )
  from generate_series(1, set_count) as series(set_no)
  cross join public.boxes box
  where box.master_item_id = p_master_item_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.created', 'label_box_batch', created_batch.id::text,
    jsonb_build_object(
      'delivery_number_id', created_batch.delivery_number_id,
      'master_item_id', created_batch.master_item_id,
      'qty_delivery', created_batch.qty_delivery,
      'packing_qty', created_batch.packing_qty,
      'label_count', created_batch.label_count,
      'lot_no', created_batch.lot_no
    )
  );

  return query
  select
    created_batch.id, target_dn.delivery_number, target_dn.delivery_date,
    target_supplier.supplier_code, target_item.item_code,
    created_batch.master_item_row_no, created_batch.packing_qty,
    created_batch.qty_delivery, created_batch.lot_no,
    created_batch.label_count, created_batch.qr_generated_at;
end;
$function$
;

notify pgrst, 'reload schema';
