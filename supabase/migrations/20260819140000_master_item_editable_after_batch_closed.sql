-- Master Item boleh disunting setelah pekerjaannya selesai, dan label lama
-- tetap memakai data lamanya.
--
-- Sebelumnya satu sesi packing saja sudah mengunci Master Item selamanya:
-- pengiriman yang sudah dikonfirmasi berbulan-bulan lalu tetap menghalangi
-- perbaikan Part No yang salah ketik. Yang benar-benar perlu dikunci hanyalah
-- pekerjaan yang masih berjalan.
--
-- Supaya penyuntingan itu aman, batch menyimpan sendiri nama part yang
-- berlaku saat ia dibuat -- nomor part, kode item, dan kode supplier sudah
-- disimpan sejak dulu -- dan pembuatan job cetak berhenti membaca
-- master_items secara langsung. Tanpa itu, label yang dicetak setelah
-- penyuntingan akan membawa nama baru meski box-nya milik kiriman lama.

alter table public.label_box_batches
  add column if not exists part_name_snapshot text;

update public.label_box_batches batch
set part_name_snapshot = item.part_name
from public.master_items item
where item.id = batch.master_item_id
  and batch.part_name_snapshot is null;

-- Batch yang Master Item-nya sudah terhapus tidak punya sumber salinan; diisi
-- penanda supaya kolomnya tetap bisa dijadikan not null.
update public.label_box_batches
set part_name_snapshot = '(tidak diketahui)'
where part_name_snapshot is null or btrim(part_name_snapshot) = '';

alter table public.label_box_batches
  alter column part_name_snapshot set not null;

alter table public.label_box_batches
  drop constraint if exists label_box_batches_part_name_snapshot_check;

alter table public.label_box_batches
  add constraint label_box_batches_part_name_snapshot_check
    check (btrim(part_name_snapshot) <> '');

create or replace function public.create_label_box_batch(p_supplier_id uuid, p_delivery_number text, p_delivery_date date, p_packing_date date, p_master_item_id uuid, p_qty_delivery integer, p_lot_no text, p_qty_delivery_display integer DEFAULT NULL::integer)
 RETURNS TABLE(batch_id uuid, delivery_number text, delivery_date date, packing_date date, supplier_code text, item_code text, master_item_row_no integer, packing_qty integer, qty_delivery integer, qty_delivery_display integer, lot_no text, label_count integer, qr_generated_at timestamp with time zone)
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
    label_count, qr_generated_at, created_by, supplier_code_snapshot,
    item_code_snapshot, part_no_snapshot, part_name_snapshot,
    delivery_number_snapshot,
    delivery_date_snapshot
  ) values (
    target_dn.id, p_supplier_id, p_master_item_id, computed_row_no,
    target_item.default_label_qty, p_qty_delivery, resolved_display,
    p_packing_date, normalized_lot_no, set_count * box_count, generated_at,
    auth.uid(), target_supplier.supplier_code, target_item.item_code,
    target_item.part_no, target_item.part_name, target_dn.delivery_number,
    target_dn.delivery_date
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
      'lot_no', created_batch.lot_no
    )
  );

  return query
  select
    created_batch.id, target_dn.delivery_number, target_dn.delivery_date,
    created_batch.packing_date, target_supplier.supplier_code,
    target_item.item_code, created_batch.master_item_row_no,
    created_batch.packing_qty, created_batch.qty_delivery,
    created_batch.qty_delivery_display, created_batch.lot_no,
    created_batch.label_count, created_batch.qr_generated_at;
end;
$function$
;

create or replace function public.create_label_box_print_jobs(p_batch_id uuid)
 RETURNS TABLE(print_job_id uuid, label_box_id uuid, box_number text, label_reference text, qr_payload text, supplier_code text, supplier_name text, part_no text, part_name text, qty integer, delivery_number text, delivery_date date, packing_date date, box_name text, lot_no text, qty_delivery integer, qty_delivery_display integer, master_item_row_no integer, status print_job_status)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
      qr_generated_at_snapshot, qr_payload_snapshot, sequence_no, label_reference,
      template_version, zpl_payload, created_by
    )
    select
      pending_box.packing_session_id, 'pending', target_batch.supplier_code_snapshot,
      supplier.supplier_name, target_batch.part_no_snapshot,
      target_batch.part_name_snapshot,
      target_batch.packing_qty, target_batch.delivery_number_snapshot,
      target_batch.delivery_date_snapshot, target_batch.packing_date,
      pending_box.box_number, pending_box.box_name, target_batch.qty_delivery,
      target_batch.lot_no, target_batch.qr_generated_at, pending_box.qr_payload,
      new_sequence_no, new_label_reference, 'v4', 'PENDING_ZPL_GENERATION', auth.uid()
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
    target_batch.master_item_row_no, job.status
  from public.label_boxes box
  join public.print_jobs job
    on job.packing_session_id = box.packing_session_id
    and job.parent_print_job_id is null
  where box.batch_id = p_batch_id
  order by box.set_no, box.box_no;
end;
$function$;

create or replace function public.update_master_item(
  p_master_item_id uuid,
  p_part_no text,
  p_part_name text,
  p_unit text,
  p_default_label_qty integer,
  p_supplier_id uuid default null
)
returns table (
  id uuid,
  item_code text,
  part_no text,
  part_name text,
  unit text,
  default_label_qty integer,
  supplier_id uuid,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_part_no text := regexp_replace(upper(btrim(p_part_no)), '\s+', ' ', 'g');
  normalized_part_name text := btrim(p_part_name);
  normalized_unit text := initcap(lower(btrim(p_unit)));
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  if normalized_part_no !~ '^[A-Z0-9][A-Z0-9 _./-]{1,127}$'
    or normalized_part_name = ''
    or char_length(normalized_part_name) > 200
    or normalized_unit !~ '^[A-Za-z][A-Za-z ./-]{0,31}$'
    or p_default_label_qty is null or p_default_label_qty < 1 or p_default_label_qty > 1000000 then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_INPUT_INVALID';
  end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers supplier
    where supplier.id = p_supplier_id and supplier.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_SUPPLIER_NOT_FOUND';
  end if;

  -- Riwayat yang sudah selesai tidak lagi mengunci Master Item-nya. Batch
  -- yang ditutup dan sesi yang sudah dikonfirmasi, dibatalkan, atau
  -- kedaluwarsa membawa salinannya sendiri, jadi labelnya tidak ikut berubah
  -- ketika Master Item disunting. Yang masih berjalan tetap dikunci: box yang
  -- belum diverifikasi atau belum dicetak masih akan membaca Master Item ini,
  -- dan menyuntingnya di tengah jalan berarti satu batch memakai dua versi
  -- data yang berbeda.
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

  begin
    update public.master_items
    set part_no = normalized_part_no,
        part_name = normalized_part_name,
        unit = normalized_unit,
        default_label_qty = p_default_label_qty,
        supplier_id = p_supplier_id
    where public.master_items.id = p_master_item_id
    returning
      public.master_items.id, public.master_items.item_code, public.master_items.part_no,
      public.master_items.part_name, public.master_items.unit, public.master_items.default_label_qty,
      public.master_items.supplier_id, public.master_items.is_active, public.master_items.created_at,
      public.master_items.updated_at
    into
      id, item_code, part_no, part_name, unit, default_label_qty, supplier_id,
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
    jsonb_build_object(
      'item_code', item_code,
      'part_no', part_no,
      'default_label_qty', default_label_qty,
      'supplier_id', supplier_id
    )
  );

  return next;
end;
$$;

notify pgrst, 'reload schema';
