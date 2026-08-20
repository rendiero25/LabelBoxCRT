-- Nama Operator: siapa yang mengepak batch ini, diisi di formulir label box dan
-- dicetak di baris Operator Pack pada labelnya.
--
-- Baris itu sebelumnya teks tetap "AD | SR | ST" -- ketiga nama operator
-- dicetak sekaligus dan yang mengepak melingkari namanya dengan pena. Nama yang
-- diketik saat batchnya dibuat membuat baris itu menyebut satu nama saja, jadi
-- label yang sudah tertempel tetap memberi tahu siapa yang mengepak tanpa
-- bergantung pada coretan tangan.
--
-- Kolomnya milik batch sendiri (seperti lot_no dan packing_date), bukan salinan
-- dari tabel lain. print_jobs mendapat operator_name_snapshot dengan daur hidup
-- yang sama persis dengan packing_date_snapshot: ditulis saat job cetak dibuat,
-- ditulis ulang saat batchnya disunting, dan disalin apa adanya saat cetak
-- ulang.
--
-- Batch lama diisi teks tetap yang lama supaya labelnya kalau dicetak ulang
-- tetap keluar seperti saat pertama dicetak.

alter table public.label_box_batches
  add column if not exists operator_name text;

update public.label_box_batches
set operator_name = 'AD | SR | ST'
where operator_name is null;

alter table public.label_box_batches
  alter column operator_name set not null;

comment on column public.label_box_batches.operator_name is
  'Nama operator yang mengepak, dicetak di baris Operator Pack pada label.';

alter table public.print_jobs
  add column if not exists operator_name_snapshot text;

update public.print_jobs job
set operator_name_snapshot = batch.operator_name
from public.label_boxes box
join public.label_box_batches batch on batch.id = box.batch_id
where box.packing_session_id = job.packing_session_id
  and job.operator_name_snapshot is null;

-- Job cetak yang sesinya sudah tidak menunjuk label box mana pun tetap harus
-- punya nilai; teks tetap yang lama adalah apa yang benar-benar tercetak dulu.
update public.print_jobs
set operator_name_snapshot = 'AD | SR | ST'
where operator_name_snapshot is null;

alter table public.print_jobs
  alter column operator_name_snapshot set not null;

comment on column public.print_jobs.operator_name_snapshot is
  'Nama operator saat job cetak dibuat, dicetak di baris Operator Pack.';

drop function if exists public.create_label_box_batch(uuid, text, date, date, uuid, integer, text, integer);

create function public.create_label_box_batch(
  p_supplier_id uuid,
  p_delivery_number text,
  p_delivery_date date,
  p_packing_date date,
  p_master_item_id uuid,
  p_qty_delivery integer,
  p_lot_no text,
  p_operator_name text default null,
  p_qty_delivery_display integer default null
)
returns table(
  batch_id uuid,
  delivery_number text,
  delivery_date date,
  packing_date date,
  supplier_code text,
  item_code text,
  master_item_row_no integer,
  packing_qty integer,
  qty_delivery integer,
  qty_delivery_display integer,
  lot_no text,
  operator_name text,
  label_count integer,
  qr_generated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_item public.master_items%rowtype;
  target_supplier public.suppliers%rowtype;
  target_dn public.delivery_numbers%rowtype;
  created_batch public.label_box_batches%rowtype;
  normalized_lot_no text := btrim(coalesce(p_lot_no, ''));
  normalized_dn text := btrim(coalesce(p_delivery_number, ''));
  normalized_operator text := btrim(coalesce(p_operator_name, ''));
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

  if target_item.supplier_id is not null
    and target_item.supplier_id <> p_supplier_id then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_SUPPLIER_MISMATCH';
  end if;

  if p_delivery_date is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_DATE_INVALID';
  end if;

  if p_packing_date is null then
    raise exception using errcode = 'P0001', message = 'PACKING_DATE_INVALID';
  end if;

  if normalized_dn = '' or char_length(normalized_dn) > 100 then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  if normalized_lot_no = '' or char_length(normalized_lot_no) > 100 then
    raise exception using errcode = 'P0001', message = 'LOT_NO_INVALID';
  end if;

  if normalized_operator = '' or char_length(normalized_operator) > 100 then
    raise exception using errcode = 'P0001', message = 'OPERATOR_NAME_INVALID';
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

  if resolved_display < 1 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_DISPLAY_INVALID';
  end if;

  if p_qty_delivery % target_item.default_label_qty <> 0 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_NOT_MULTIPLE';
  end if;

  set_count := p_qty_delivery / target_item.default_label_qty;

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
      select * into target_dn
      from public.delivery_numbers dn
      where dn.supplier_id = p_supplier_id
        and lower(btrim(dn.delivery_number)) = lower(normalized_dn);
    end;
  end if;

  if target_dn.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  if target_dn.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_NOT_ACTIVE';
  end if;

  if target_dn.delivery_date <> p_delivery_date then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_DATE_MISMATCH';
  end if;

  select ranked.position into computed_row_no
  from (
    select item.id, (row_number() over (order by item.item_code))::integer as position
    from public.master_items item
  ) ranked
  where ranked.id = p_master_item_id;

  insert into public.label_box_batches (
    delivery_number_id, supplier_id, master_item_id, master_item_row_no,
    packing_qty, qty_delivery, qty_delivery_display, packing_date, lot_no,
    operator_name, label_count, qr_generated_at, created_by,
    supplier_code_snapshot, item_code_snapshot, part_no_snapshot,
    part_name_snapshot, delivery_number_snapshot, delivery_date_snapshot
  ) values (
    target_dn.id, p_supplier_id, p_master_item_id, computed_row_no,
    target_item.default_label_qty, p_qty_delivery, resolved_display,
    p_packing_date, normalized_lot_no, normalized_operator,
    set_count * box_count, generated_at, auth.uid(),
    target_supplier.supplier_code, target_item.item_code, target_item.part_no,
    target_item.part_name, target_dn.delivery_number, target_dn.delivery_date
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
      concat_ws(
        '-',
        computed_row_no::text,
        normalized_lot_no,
        'B' || box.box_no::text || lpad(series.set_no::text, 2, '0')
      ),
      private.label_date_text(target_dn.delivery_date)
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
      'packing_date', created_batch.packing_date,
      'label_count', created_batch.label_count,
      'lot_no', created_batch.lot_no,
      'operator_name', created_batch.operator_name
    )
  );

  return query
  select
    created_batch.id, target_dn.delivery_number, target_dn.delivery_date,
    created_batch.packing_date, target_supplier.supplier_code,
    target_item.item_code, created_batch.master_item_row_no,
    created_batch.packing_qty, created_batch.qty_delivery,
    created_batch.qty_delivery_display, created_batch.lot_no,
    created_batch.operator_name, created_batch.label_count,
    created_batch.qr_generated_at;
end;
$function$;

revoke execute on function public.create_label_box_batch(uuid, text, date, date, uuid, integer, text, text, integer) from public, anon;
grant execute on function public.create_label_box_batch(uuid, text, date, date, uuid, integer, text, text, integer) to authenticated;
grant execute on function public.create_label_box_batch(uuid, text, date, date, uuid, integer, text, text, integer) to service_role;

drop function if exists public.update_label_box_batch(uuid, text, date, date, text);

create function public.update_label_box_batch(
  p_batch_id uuid,
  p_delivery_number text,
  p_delivery_date date,
  p_packing_date date,
  p_lot_no text,
  p_operator_name text default null
)
returns table(
  batch_id uuid,
  delivery_number text,
  delivery_date date,
  packing_date date,
  lot_no text,
  operator_name text,
  label_count integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_batch public.label_box_batches%rowtype;
  target_dn public.delivery_numbers%rowtype;
  previous_dn_id uuid;
  normalized_dn text := btrim(coalesce(p_delivery_number, ''));
  normalized_lot_no text := btrim(coalesce(p_lot_no, ''));
  normalized_operator text := btrim(coalesce(p_operator_name, ''));
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

  if p_delivery_date is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_DATE_INVALID';
  end if;

  if p_packing_date is null then
    raise exception using errcode = 'P0001', message = 'PACKING_DATE_INVALID';
  end if;

  if normalized_dn = '' or char_length(normalized_dn) > 100 then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  if normalized_lot_no = '' or char_length(normalized_lot_no) > 100 then
    raise exception using errcode = 'P0001', message = 'LOT_NO_INVALID';
  end if;

  if normalized_operator = '' or char_length(normalized_operator) > 100 then
    raise exception using errcode = 'P0001', message = 'OPERATOR_NAME_INVALID';
  end if;

  previous_dn_id := target_batch.delivery_number_id;

  select * into target_dn
  from public.delivery_numbers dn
  where dn.supplier_id = target_batch.supplier_id
    and lower(btrim(dn.delivery_number)) = lower(normalized_dn)
  for update;

  if target_dn.id is null then
    insert into public.delivery_numbers (
      supplier_id, delivery_number, delivery_date, status, created_by
    ) values (
      target_batch.supplier_id, normalized_dn, p_delivery_date, 'active', auth.uid()
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
        'source', 'label_box_batch_update'
      )
    );
  end if;

  if target_dn.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_NOT_ACTIVE';
  end if;

  if target_dn.delivery_date <> p_delivery_date then
    if exists (
      select 1 from public.label_box_batches other
      where other.delivery_number_id = target_dn.id and other.id <> p_batch_id
    ) then
      raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_DATE_SHARED';
    end if;

    update public.delivery_numbers dn
    set delivery_date = p_delivery_date
    where dn.id = target_dn.id
    returning * into target_dn;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      auth.uid(), 'delivery_number.updated', 'delivery_number', target_dn.id::text,
      jsonb_build_object(
        'delivery_date', target_dn.delivery_date,
        'source', 'label_box_batch_update'
      )
    );
  end if;

  update public.label_box_batches batch
  set
    delivery_number_id = target_dn.id,
    lot_no = normalized_lot_no,
    operator_name = normalized_operator,
    packing_date = p_packing_date,
    delivery_number_snapshot = target_dn.delivery_number,
    delivery_date_snapshot = target_dn.delivery_date
  where batch.id = p_batch_id
  returning * into target_batch;

  update public.label_boxes box
  set qr_payload = concat_ws(
    '|',
    target_batch.supplier_code_snapshot,
    target_batch.part_no_snapshot,
    target_batch.packing_qty::text,
    concat_ws(
      '-',
      target_batch.master_item_row_no::text,
      target_batch.lot_no,
      box.box_number
    ),
    private.label_date_text(target_batch.delivery_date_snapshot)
  )
  where box.batch_id = p_batch_id;

  update public.packing_sessions session
  set lot_no = target_batch.lot_no,
    delivery_number_id = target_batch.delivery_number_id
  where session.id in (
    select box.packing_session_id
    from public.label_boxes box
    where box.batch_id = p_batch_id and box.packing_session_id is not null
  );

  update public.print_jobs job
  set
    lot_no_snapshot = target_batch.lot_no,
    operator_name_snapshot = target_batch.operator_name,
    delivery_number_snapshot = target_batch.delivery_number_snapshot,
    delivery_date_snapshot = target_batch.delivery_date_snapshot,
    packing_date_snapshot = target_batch.packing_date,
    qr_payload_snapshot = box.qr_payload
  from public.label_boxes box
  where box.batch_id = p_batch_id
    and job.packing_session_id = box.packing_session_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.updated', 'label_box_batch', p_batch_id::text,
    jsonb_build_object(
      'delivery_number_id_before', previous_dn_id,
      'delivery_number_id_after', target_batch.delivery_number_id,
      'delivery_number', target_batch.delivery_number_snapshot,
      'delivery_date', target_batch.delivery_date_snapshot,
      'packing_date', target_batch.packing_date,
      'lot_no', target_batch.lot_no,
      'operator_name', target_batch.operator_name
    )
  );

  return query
  select
    target_batch.id, target_batch.delivery_number_snapshot,
    target_batch.delivery_date_snapshot, target_batch.packing_date,
    target_batch.lot_no, target_batch.operator_name, target_batch.label_count;
end;
$function$;

revoke execute on function public.update_label_box_batch(uuid, text, date, date, text, text) from public, anon;
grant execute on function public.update_label_box_batch(uuid, text, date, date, text, text) to authenticated;
grant execute on function public.update_label_box_batch(uuid, text, date, date, text, text) to service_role;

drop function if exists public.rebuild_label_box_batch(uuid, uuid, text, date, date, uuid, integer, text, integer);

create function public.rebuild_label_box_batch(
  p_batch_id uuid,
  p_supplier_id uuid,
  p_delivery_number text,
  p_delivery_date date,
  p_packing_date date,
  p_master_item_id uuid,
  p_qty_delivery integer,
  p_lot_no text,
  p_operator_name text default null,
  p_qty_delivery_display integer default null
)
returns table (
  batch_id uuid,
  delivery_number text,
  delivery_date date,
  packing_date date,
  supplier_code text,
  item_code text,
  master_item_row_no integer,
  packing_qty integer,
  qty_delivery integer,
  qty_delivery_display integer,
  lot_no text,
  operator_name text,
  label_count integer,
  qr_generated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_batch public.label_box_batches%rowtype;
  session_ids uuid[];
  job_ids uuid[];
  target_item public.master_items%rowtype;
  target_supplier public.suppliers%rowtype;
  target_dn public.delivery_numbers%rowtype;
  created_batch public.label_box_batches%rowtype;
  normalized_lot_no text := btrim(coalesce(p_lot_no, ''));
  normalized_dn text := btrim(coalesce(p_delivery_number, ''));
  normalized_operator text := btrim(coalesce(p_operator_name, ''));
  resolved_display integer := coalesce(p_qty_delivery_display, p_qty_delivery);
  box_count integer;
  set_count integer;
  computed_row_no integer;
  generated_at timestamptz := statement_timestamp();
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

  -- Batch yang verifikasinya sudah selesai tidak boleh dirakit ulang: labelnya
  -- sudah tercetak dan menempel di box, dan hasil scannya adalah bukti kiriman.
  if target_batch.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_CLOSED';
  end if;

  select * into target_supplier
  from public.suppliers supplier
  where supplier.id = p_supplier_id and supplier.is_active;

  if target_supplier.id is null then
    raise exception using errcode = 'P0001', message = 'SUPPLIER_INVALID';
  end if;

  select * into target_item
  from public.master_items item
  where item.id = p_master_item_id and item.is_active and item.deleted_at is null;

  if target_item.id is null then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_ACTIVE';
  end if;

  if target_item.supplier_id is not null
    and target_item.supplier_id <> p_supplier_id then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_SUPPLIER_MISMATCH';
  end if;

  if p_delivery_date is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_DATE_INVALID';
  end if;

  if p_packing_date is null then
    raise exception using errcode = 'P0001', message = 'PACKING_DATE_INVALID';
  end if;

  if normalized_dn = '' or char_length(normalized_dn) > 100 then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  if normalized_lot_no = '' or char_length(normalized_lot_no) > 100 then
    raise exception using errcode = 'P0001', message = 'LOT_NO_INVALID';
  end if;

  if normalized_operator = '' or char_length(normalized_operator) > 100 then
    raise exception using errcode = 'P0001', message = 'OPERATOR_NAME_INVALID';
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

  if resolved_display < 1 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_DISPLAY_INVALID';
  end if;

  if p_qty_delivery % target_item.default_label_qty <> 0 then
    raise exception using errcode = 'P0001', message = 'QTY_DELIVERY_NOT_MULTIPLE';
  end if;

  set_count := p_qty_delivery / target_item.default_label_qty;

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
      select * into target_dn
      from public.delivery_numbers dn
      where dn.supplier_id = p_supplier_id
        and lower(btrim(dn.delivery_number)) = lower(normalized_dn);
    end;
  end if;

  if target_dn.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INVALID';
  end if;

  if target_dn.status <> 'active' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_NOT_ACTIVE';
  end if;

  if target_dn.delivery_date <> p_delivery_date then
    if exists (
      select 1 from public.label_box_batches other
      where other.delivery_number_id = target_dn.id and other.id <> p_batch_id
    ) then
      raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_DATE_SHARED';
    end if;

    update public.delivery_numbers dn
    set delivery_date = p_delivery_date
    where dn.id = target_dn.id
    returning * into target_dn;
  end if;

  select ranked.position into computed_row_no
  from (
    select item.id, (row_number() over (order by item.item_code))::integer as position
    from public.master_items item
  ) ranked
  where ranked.id = p_master_item_id;

  -- Isi lama batch ini dibuang lebih dulu: nomor box, hasil scan, dan job
  -- cetaknya dirakit dari data yang baru saja diganti, jadi tidak ada satu pun
  -- yang masih berlaku. Urutannya mengikuti delete_label_box_batch -- anak
  -- print_jobs dulu, baru induknya.
  select
    coalesce(array_agg(box.packing_session_id) filter (where box.packing_session_id is not null), '{}')
  into session_ids
  from public.label_boxes box
  where box.batch_id = p_batch_id;

  select coalesce(array_agg(job.id), '{}') into job_ids
  from public.print_jobs job
  where job.packing_session_id = any(session_ids);

  delete from public.print_attempts attempt
  where attempt.print_job_id = any(job_ids);

  delete from public.reprint_requests request
  where request.source_print_job_id = any(job_ids);

  delete from public.print_jobs job
  where job.id = any(job_ids) and job.parent_print_job_id is not null;

  delete from public.print_jobs job
  where job.id = any(job_ids);

  delete from public.packing_session_scans scan
  where scan.packing_session_id = any(session_ids)
    or scan.label_box_batch_id = p_batch_id;

  delete from public.label_boxes box
  where box.batch_id = p_batch_id;

  delete from public.packing_sessions session
  where session.id = any(session_ids);

  update public.label_box_batches batch
  set
    delivery_number_id = target_dn.id,
    supplier_id = p_supplier_id,
    master_item_id = p_master_item_id,
    master_item_row_no = computed_row_no,
    packing_qty = target_item.default_label_qty,
    qty_delivery = p_qty_delivery,
    qty_delivery_display = resolved_display,
    packing_date = p_packing_date,
    lot_no = normalized_lot_no,
    operator_name = normalized_operator,
    label_count = set_count * box_count,
    qr_generated_at = generated_at,
    supplier_code_snapshot = target_supplier.supplier_code,
    item_code_snapshot = target_item.item_code,
    part_no_snapshot = target_item.part_no,
    part_name_snapshot = target_item.part_name,
    delivery_number_snapshot = target_dn.delivery_number,
    delivery_date_snapshot = target_dn.delivery_date
  where batch.id = p_batch_id
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
      concat_ws(
        '-',
        computed_row_no::text,
        normalized_lot_no,
        'B' || box.box_no::text || lpad(series.set_no::text, 2, '0')
      ),
      private.label_date_text(target_dn.delivery_date)
    )
  from generate_series(1, set_count) as series(set_no)
  cross join public.boxes box
  where box.master_item_id = p_master_item_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.rebuilt', 'label_box_batch', created_batch.id::text,
    jsonb_build_object(
      'delivery_number_id', created_batch.delivery_number_id,
      'master_item_id', created_batch.master_item_id,
      'qty_delivery', created_batch.qty_delivery,
      'qty_delivery_display', created_batch.qty_delivery_display,
      'packing_qty', created_batch.packing_qty,
      'packing_date', created_batch.packing_date,
      'label_count', created_batch.label_count,
      'lot_no', created_batch.lot_no,
      'operator_name', created_batch.operator_name
    )
  );

  return query
  select
    created_batch.id, target_dn.delivery_number, target_dn.delivery_date,
    created_batch.packing_date, target_supplier.supplier_code,
    target_item.item_code, created_batch.master_item_row_no,
    created_batch.packing_qty, created_batch.qty_delivery,
    created_batch.qty_delivery_display, created_batch.lot_no,
    created_batch.operator_name, created_batch.label_count,
    created_batch.qr_generated_at;
end;
$function$;

revoke execute on function public.rebuild_label_box_batch(uuid, uuid, text, date, date, uuid, integer, text, text, integer) from public, anon;
grant execute on function public.rebuild_label_box_batch(uuid, uuid, text, date, date, uuid, integer, text, text, integer) to authenticated;
grant execute on function public.rebuild_label_box_batch(uuid, uuid, text, date, date, uuid, integer, text, text, integer) to service_role;

drop function if exists public.create_label_box_print_jobs(uuid);

create function public.create_label_box_print_jobs(p_batch_id uuid)
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
  packing_date date,
  box_name text,
  lot_no text,
  qty_delivery integer,
  qty_delivery_display integer,
  master_item_row_no integer,
  status public.print_job_status,
  operator_name text
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  target_batch public.label_box_batches%rowtype;
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
      delivery_date_snapshot, packing_date_snapshot, box_code_snapshot,
      box_name_snapshot, qty_delivery_snapshot, lot_no_snapshot,
      operator_name_snapshot, qr_generated_at_snapshot, qr_payload_snapshot,
      sequence_no, label_reference, template_version, zpl_payload, created_by
    )
    select
      pending_box.packing_session_id, 'pending', target_batch.supplier_code_snapshot,
      supplier.supplier_name, target_batch.part_no_snapshot,
      target_batch.part_name_snapshot,
      target_batch.packing_qty, target_batch.delivery_number_snapshot,
      target_batch.delivery_date_snapshot, target_batch.packing_date,
      pending_box.box_number, pending_box.box_name, target_batch.qty_delivery,
      target_batch.lot_no, target_batch.operator_name, target_batch.qr_generated_at,
      pending_box.qr_payload, new_sequence_no, new_label_reference, 'v4',
      'PENDING_ZPL_GENERATION', auth.uid()
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
    job.delivery_date_snapshot, job.packing_date_snapshot, job.box_name_snapshot,
    job.lot_no_snapshot, job.qty_delivery_snapshot, target_batch.qty_delivery_display,
    target_batch.master_item_row_no, job.status, job.operator_name_snapshot
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
  packing_date date,
  box_name text,
  lot_no text,
  qty_delivery integer,
  qty_delivery_display integer,
  master_item_row_no integer,
  status public.print_job_status,
  operator_name text
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
    parent_job := null;
    pending_job := null;

    select * into parent_job
    from public.print_jobs job
    where job.packing_session_id = target_box.packing_session_id
      and job.parent_print_job_id is null;

    if parent_job.id is null then
      raise exception using errcode = 'P0001', message = 'LABEL_BOX_NOT_PRINTED';
    end if;

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
      delivery_number_snapshot, delivery_date_snapshot, packing_date_snapshot,
      box_code_snapshot, box_name_snapshot, qty_delivery_snapshot, lot_no_snapshot,
      operator_name_snapshot, qr_generated_at_snapshot, qr_payload_snapshot,
      sequence_no, label_reference, template_version, zpl_payload, created_by
    )
    select
      parent_job.packing_session_id, parent_job.id, 'pending',
      parent_job.supplier_code_snapshot, parent_job.supplier_name_snapshot,
      parent_job.part_no_snapshot, parent_job.part_name_snapshot,
      parent_job.qty_snapshot, parent_job.delivery_number_snapshot,
      parent_job.delivery_date_snapshot, parent_job.packing_date_snapshot,
      parent_job.box_code_snapshot, parent_job.box_name_snapshot,
      parent_job.qty_delivery_snapshot, parent_job.lot_no_snapshot,
      parent_job.operator_name_snapshot, parent_job.qr_generated_at_snapshot,
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
    job.delivery_date_snapshot, job.packing_date_snapshot, job.box_name_snapshot,
    job.lot_no_snapshot, job.qty_delivery_snapshot, target_batch.qty_delivery_display,
    target_batch.master_item_row_no, job.status, job.operator_name_snapshot
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
