-- Jumlah label dan angka Qty/Delivery yang tercetak dipisah.
--
-- Sampai sekarang label_box_batches.qty_delivery memikul dua peran sekaligus:
-- ia yang dibagi Packing Qty Master Item untuk menentukan berapa set label
-- dibuat, sekaligus angka yang tercetak di baris Qty/Delivery. Selama keduanya
-- kebetulan sama itu tidak terasa, tetapi operator memerlukan angka kiriman
-- yang berdiri sendiri: yang menentukan jumlah label adalah berapa keping yang
-- dipak, sedangkan yang dicetak adalah jumlah kiriman menurut surat jalan.
--
-- qty_delivery tetap menjadi penentu jumlah label — form menyebutnya "Packing
-- Qty" karena itu yang dipahami operator — dan qty_delivery_display menjadi
-- angka yang dibaca dari label. Batch lama diisi dengan nilai yang sama,
-- sehingga labelnya tetap bercerita seperti sebelumnya.

alter table public.label_box_batches
  add column if not exists qty_delivery_display integer
    check (qty_delivery_display is null or qty_delivery_display > 0);

update public.label_box_batches
set qty_delivery_display = qty_delivery
where qty_delivery_display is null;

comment on column public.label_box_batches.qty_delivery is
  'Keping yang dipak; dibagi packing_qty menjadi jumlah set label. Form menyebutnya Packing Qty.';
comment on column public.label_box_batches.qty_delivery_display is
  'Angka yang dicetak di baris Qty/Delivery label. Tidak menentukan apa pun.';

drop function if exists public.create_label_box_batch(uuid, text, date, uuid, integer, text);

CREATE FUNCTION public.create_label_box_batch(p_supplier_id uuid, p_delivery_number text, p_delivery_date date, p_master_item_id uuid, p_qty_delivery integer, p_lot_no text, p_qty_delivery_display integer DEFAULT NULL::integer)
 RETURNS TABLE(batch_id uuid, delivery_number text, delivery_date date, supplier_code text, item_code text, master_item_row_no integer, packing_qty integer, qty_delivery integer, qty_delivery_display integer, lot_no text, label_count integer, qr_generated_at timestamp with time zone)
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
  resolved_display integer := coalesce(p_qty_delivery_display, p_qty_delivery);
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

  -- Angka yang dicetak tidak menentukan apa pun, jadi ia hanya perlu masuk akal
  -- sebagai jumlah: tidak nol, tidak negatif.
  if resolved_display < 1 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_DISPLAY_INVALID';
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
    packing_qty, qty_delivery, qty_delivery_display, lot_no, label_count,
    qr_generated_at, created_by, supplier_code_snapshot, item_code_snapshot,
    part_no_snapshot, delivery_number_snapshot, delivery_date_snapshot
  ) values (
    target_dn.id, p_supplier_id, p_master_item_id, computed_row_no,
    target_item.default_label_qty, p_qty_delivery, resolved_display,
    normalized_lot_no, set_count * box_count, generated_at, auth.uid(),
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
      'qty_delivery_display', created_batch.qty_delivery_display,
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
    created_batch.qty_delivery, created_batch.qty_delivery_display,
    created_batch.lot_no, created_batch.label_count, created_batch.qr_generated_at;
end;
$function$;

revoke execute on function public.create_label_box_batch(uuid, text, date, uuid, integer, text, integer) from public, anon;
grant execute on function public.create_label_box_batch(uuid, text, date, uuid, integer, text, integer) to authenticated;
grant execute on function public.create_label_box_batch(uuid, text, date, uuid, integer, text, integer) to service_role;

-- Kedua RPC pembuat print job ikut mengeluarkan angka cetaknya. Diambil dari
-- batch, bukan dari snapshot print_jobs, sama seperti master_item_row_no:
-- angka itu tidak pernah berubah setelah batch dibuat.

drop function if exists public.create_label_box_print_jobs(uuid);

CREATE FUNCTION public.create_label_box_print_jobs(p_batch_id uuid)
 RETURNS TABLE(print_job_id uuid, label_box_id uuid, box_number text, label_reference text, qr_payload text, supplier_code text, supplier_name text, part_no text, part_name text, qty integer, delivery_number text, delivery_date date, box_name text, lot_no text, qty_delivery integer, qty_delivery_display integer, master_item_row_no integer, status print_job_status)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_batch public.label_box_batches%rowtype;
  target_item public.master_items%rowtype;
  pending_box record;
  unscanned_box public.label_boxes%rowtype;
  created_session public.packing_sessions%rowtype;
  new_sequence_no bigint;
  new_label_reference text;
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

  -- Batch terbuka: boleh cetak hanya bila seluruh label box sudah penuh. Box
  -- yang layernya tidak meminta produk apa pun dikecualikan, karena box seperti
  -- itu tidak pernah bisa penuh. Batch yang sudah ditutup dibiarkan lewat
  -- supaya cetak ulang tetap bisa.
  if target_batch.closed_at is null and exists (
    select 1
    from public.label_boxes box
    where box.batch_id = p_batch_id
      and box.status <> 'verified'
      and exists (
        select 1
        from public.box_layers layer
        join public.box_layer_requirements requirement
          on requirement.box_layer_id = layer.id
        where layer.box_id = box.box_id
      )
  ) then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_SETS_INCOMPLETE';
  end if;

  select * into target_item
  from public.master_items item
  where item.id = target_batch.master_item_id;

  for unscanned_box in
    select * from public.label_boxes box
    where box.batch_id = p_batch_id and box.packing_session_id is null
    order by box.set_no, box.box_no
  loop
    insert into public.packing_sessions (
      operator_id, master_item_id, box_id, delivery_number_id,
      qty_delivery, lot_no, status
    ) values (
      auth.uid(), target_batch.master_item_id, unscanned_box.box_id,
      target_batch.delivery_number_id, target_batch.qty_delivery,
      target_batch.lot_no, 'scanning'
    )
    returning * into created_session;

    update public.label_boxes box
    set packing_session_id = created_session.id
    where box.id = unscanned_box.id;
  end loop;

  -- Idempoten: hanya box yang belum punya print job yang diproses, sehingga
  -- memanggil ulang tidak menggandakan label.
  for pending_box in
    select box.*, boxes.box_name
    from public.label_boxes box
    join public.boxes boxes on boxes.id = box.box_id
    where box.batch_id = p_batch_id
      and not exists (
        select 1 from public.print_jobs job
        where job.packing_session_id = box.packing_session_id
          and job.parent_print_job_id is null
      )
    order by box.set_no, box.box_no
  loop
    select nextval('public.print_job_sequence') into new_sequence_no;

    new_label_reference := new_sequence_no::text || '-'
      || to_char(target_batch.delivery_date_snapshot, 'DDMMYY') || '-'
      || pending_box.box_number;

    insert into public.print_jobs (
      packing_session_id, status, supplier_code_snapshot, supplier_name_snapshot,
      part_no_snapshot, part_name_snapshot, qty_snapshot, delivery_number_snapshot,
      delivery_date_snapshot, box_code_snapshot, box_name_snapshot,
      qty_delivery_snapshot, lot_no_snapshot, qr_generated_at_snapshot,
      qr_payload_snapshot, sequence_no, label_reference, template_version,
      zpl_payload, created_by
    )
    select
      pending_box.packing_session_id, 'pending', target_batch.supplier_code_snapshot,
      supplier.supplier_name, target_item.part_no, target_item.part_name,
      target_batch.packing_qty, target_batch.delivery_number_snapshot,
      target_batch.delivery_date_snapshot, pending_box.box_number,
      pending_box.box_name, target_batch.qty_delivery, target_batch.lot_no,
      target_batch.qr_generated_at, pending_box.qr_payload, new_sequence_no,
      new_label_reference, 'v4', 'PENDING_ZPL_GENERATION', auth.uid()
    from public.suppliers supplier
    where supplier.id = target_batch.supplier_id;
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.print_jobs_created', 'label_box_batch',
    p_batch_id::text,
    jsonb_build_object(
      'label_count', target_batch.label_count,
      'batch_closed', target_batch.closed_at is not null
    )
  );

  return query
  select
    job.id, box.id, box.box_number, job.label_reference, job.qr_payload_snapshot,
    job.supplier_code_snapshot, job.supplier_name_snapshot, job.part_no_snapshot,
    job.part_name_snapshot, job.qty_snapshot, job.delivery_number_snapshot,
    job.delivery_date_snapshot, job.box_name_snapshot, job.lot_no_snapshot,
    job.qty_delivery_snapshot, target_batch.qty_delivery_display,
    target_batch.master_item_row_no, job.status
  from public.label_boxes box
  join public.print_jobs job
    on job.packing_session_id = box.packing_session_id
    and job.parent_print_job_id is null
  where box.batch_id = p_batch_id
  order by box.set_no, box.box_no;
end;
$function$;

grant execute on function public.create_label_box_print_jobs(uuid) to authenticated;
grant execute on function public.create_label_box_print_jobs(uuid) to service_role;

drop function if exists public.create_label_box_reprint_jobs(uuid, uuid[]);

create function public.create_label_box_reprint_jobs(
  p_batch_id uuid,
  p_label_box_ids uuid[] default null
)
returns table(
  print_job_id uuid,
  label_box_id uuid,
  box_number text,
  label_reference text,
  qr_payload text,
  supplier_code text,
  supplier_name text,
  part_no text,
  part_name text,
  qty integer,
  delivery_number text,
  delivery_date date,
  box_name text,
  lot_no text,
  qty_delivery integer,
  qty_delivery_display integer,
  master_item_row_no integer,
  status public.print_job_status
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_batch public.label_box_batches%rowtype;
  target_box record;
  parent_job public.print_jobs%rowtype;
  pending_job public.print_jobs%rowtype;
  reprint_ids uuid[] := '{}';
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

  for target_box in
    select box.*
    from public.label_boxes box
    where box.batch_id = p_batch_id
      and (p_label_box_ids is null or box.id = any(p_label_box_ids))
    order by box.set_no, box.box_no
  loop
    -- SELECT INTO tidak mengosongkan variabel ketika tidak ada baris, jadi
    -- keduanya direset dulu; tanpa itu box berikutnya mewarisi job box
    -- sebelumnya dan mencetak label yang salah.
    parent_job := null;
    pending_job := null;

    select * into parent_job
    from public.print_jobs job
    where job.packing_session_id = target_box.packing_session_id
      and job.parent_print_job_id is null;

    -- Box yang belum pernah dicetak tidak punya induk untuk disalin; label
    -- pertamanya dibuat create_label_box_print_jobs, bukan di sini.
    if parent_job.id is null then
      raise exception using errcode = 'P0001', message = 'LABEL_BOX_NOT_PRINTED';
    end if;

    -- Sudah ada cetakan yang belum tuntas untuk box ini: pakai job itu supaya
    -- satu penekanan tombol tidak menumpuk antrean label yang sama.
    select * into pending_job
    from public.print_jobs job
    where (job.id = parent_job.id or job.parent_print_job_id = parent_job.id)
      and job.status in ('pending', 'printing')
    order by job.created_at desc
    limit 1;

    if pending_job.id is not null then
      reprint_ids := reprint_ids || pending_job.id;
      continue;
    end if;

    insert into public.print_jobs (
      packing_session_id, parent_print_job_id, status, supplier_code_snapshot,
      supplier_name_snapshot, part_no_snapshot, part_name_snapshot, qty_snapshot,
      delivery_number_snapshot, delivery_date_snapshot, box_code_snapshot,
      box_name_snapshot, qty_delivery_snapshot, lot_no_snapshot,
      qr_generated_at_snapshot, qr_payload_snapshot, sequence_no,
      label_reference, template_version, zpl_payload, created_by
    )
    select
      parent_job.packing_session_id, parent_job.id, 'pending',
      parent_job.supplier_code_snapshot, parent_job.supplier_name_snapshot,
      parent_job.part_no_snapshot, parent_job.part_name_snapshot,
      parent_job.qty_snapshot, parent_job.delivery_number_snapshot,
      parent_job.delivery_date_snapshot, parent_job.box_code_snapshot,
      parent_job.box_name_snapshot, parent_job.qty_delivery_snapshot,
      parent_job.lot_no_snapshot, parent_job.qr_generated_at_snapshot,
      parent_job.qr_payload_snapshot, parent_job.sequence_no,
      parent_job.label_reference, parent_job.template_version,
      'PENDING_ZPL_GENERATION', auth.uid()
    returning id into pending_job.id;

    reprint_ids := reprint_ids || pending_job.id;
  end loop;

  if array_length(reprint_ids, 1) is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.reprint_jobs_created', 'label_box_batch',
    p_batch_id::text,
    jsonb_build_object(
      'reprint_count', array_length(reprint_ids, 1),
      'whole_batch', p_label_box_ids is null
    )
  );

  return query
  select
    job.id, box.id, box.box_number, job.label_reference, job.qr_payload_snapshot,
    job.supplier_code_snapshot, job.supplier_name_snapshot, job.part_no_snapshot,
    job.part_name_snapshot, job.qty_snapshot, job.delivery_number_snapshot,
    job.delivery_date_snapshot, job.box_name_snapshot, job.lot_no_snapshot,
    job.qty_delivery_snapshot, target_batch.qty_delivery_display,
    target_batch.master_item_row_no, job.status
  from public.print_jobs job
  join public.label_boxes box
    on box.packing_session_id = job.packing_session_id
  where job.id = any(reprint_ids)
  order by box.set_no, box.box_no;
end;
$function$;

grant execute on function public.create_label_box_reprint_jobs(uuid, uuid[]) to authenticated;
grant execute on function public.create_label_box_reprint_jobs(uuid, uuid[]) to service_role;

notify pgrst, 'reload schema';
