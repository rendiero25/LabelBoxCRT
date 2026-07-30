-- Hapus peran operator (permintaan 2026-07-30).
--
-- Frontend selalu meloloskan admin lewat hasRequiredRole, tetapi
-- private.is_active_operator() mensyaratkan role = 'operator' persis, jadi
-- admin bisa membuka /scan namun ditolak setiap RPC. Peran operator tidak
-- dipakai lagi: siapa pun yang punya profil aktif boleh memakai alur scan
-- dan label box. Area admin tetap terkunci lewat private.is_active_admin().
--
-- Fungsi diganti nama, bukan dibuat baru, supaya sepuluh policy yang
-- menyebutnya ikut terbawa: policy menyimpan rujukan sebagai OID, sedangkan
-- badan fungsi plpgsql menyimpannya sebagai teks dan harus ditulis ulang.

alter function private.is_active_operator() rename to is_active_app_user;

create or replace function private.is_active_app_user()
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $fn$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active
  );
$fn$;

revoke execute on function private.is_active_app_user() from public, anon;
grant execute on function private.is_active_app_user() to authenticated;

-- accept_label_box_scan
CREATE OR REPLACE FUNCTION public.accept_label_box_scan(p_batch_id uuid, p_label_uid text, p_raw_payload_hash text, p_scanned_size text, p_normalized_size text)
 RETURNS TABLE(result scan_result, error_code text, label_box_id uuid, box_number text, label_box_status label_box_status, layer_accepted_qty integer, layer_expected_qty integer, total_accepted_qty integer, total_expected_qty integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_batch public.label_box_batches%rowtype;
  target_box public.label_boxes%rowtype;
  created_session public.packing_sessions%rowtype;
  scan_row record;
begin
  if not private.is_active_app_user() then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_OPERATOR_REQUIRED';
  end if;

  select * into target_batch
  from public.label_box_batches batch
  where batch.id = p_batch_id;

  if target_batch.id is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_NOT_FOUND';
  end if;

  if target_batch.closed_at is not null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_CLOSED';
  end if;

  -- Box tujuan: nomor terkecil yang belum penuh. Urutan set lalu box
  -- mencerminkan urutan pengepakan di lapangan. skip locked supaya dua
  -- operator pada batch yang sama mengisi box berbeda, bukan saling
  -- menunggu lalu menerima NO_LABEL_BOX_AVAILABLE palsu ketika box yang
  -- dikunci berubah status sebelum lock dilepas.
  select * into target_box
  from public.label_boxes box
  where box.batch_id = p_batch_id and box.status <> 'verified'
  order by box.set_no, box.box_no
  limit 1
  for update skip locked;

  if target_box.id is null then
    raise exception using errcode = 'P0001', message = 'NO_LABEL_BOX_AVAILABLE';
  end if;

  if target_box.packing_session_id is null then
    insert into public.packing_sessions (
      operator_id, master_item_id, box_id, delivery_number_id,
      qty_delivery, lot_no, status
    ) values (
      auth.uid(), target_batch.master_item_id, target_box.box_id,
      target_batch.delivery_number_id, target_batch.qty_delivery,
      target_batch.lot_no, 'scanning'
    )
    returning * into created_session;

    update public.label_boxes box
    set packing_session_id = created_session.id
    where box.id = target_box.id
    returning * into target_box;
  end if;

  select * into scan_row
  from public.accept_packing_scan(
    target_box.packing_session_id,
    p_label_uid,
    p_raw_payload_hash,
    p_scanned_size,
    p_normalized_size
  );

  if scan_row.session_status = 'ready_to_finalize' then
    update public.label_boxes box
    set status = 'verified'
    where box.id = target_box.id;
  end if;

  return query
  select
    scan_row.result,
    scan_row.error_code,
    target_box.id,
    target_box.box_number,
    (
      select box.status from public.label_boxes box where box.id = target_box.id
    ),
    scan_row.layer_accepted_qty,
    scan_row.layer_expected_qty,
    scan_row.total_accepted_qty,
    scan_row.total_expected_qty;
end;
$function$;

-- claim_print_job
CREATE OR REPLACE FUNCTION public.claim_print_job(p_print_job_id uuid, p_zpl_payload text)
 RETURNS TABLE(print_job_id uuid, packing_session_id uuid, job_status print_job_status, session_status packing_session_status, attempt_count integer, label_reference text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_job public.print_jobs%rowtype;
  target_session public.packing_sessions%rowtype;
  resulting_session_status public.packing_session_status;
begin
  if not (select private.is_active_app_user()) and not (select private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_FORBIDDEN';
  end if;

  if p_zpl_payload is null
     or length(p_zpl_payload) = 0
     or length(p_zpl_payload) > 16384
     or p_zpl_payload not like '^XA%'
     or p_zpl_payload not like '%^XZ' then
    raise exception using errcode = 'P0001', message = 'PRINT_PAYLOAD_INVALID';
  end if;

  select * into target_job
  from public.print_jobs job
  where job.id = p_print_job_id
  for update;

  if target_job.id is null then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_NOT_FOUND';
  end if;

  select * into target_session
  from public.packing_sessions session
  where session.id = target_job.packing_session_id
  for update;

  if target_session.operator_id <> auth.uid() and not (select private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_FORBIDDEN';
  end if;

  -- Claimable: fresh (pending), retry (failed), or stale self re-claim
  -- (printing older than 2 minutes — tab died mid-print).
  if not (
    target_job.status in ('pending', 'failed')
    or (
      target_job.status = 'printing'
      and target_job.updated_at < statement_timestamp() - interval '2 minutes'
    )
  ) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_NOT_CLAIMABLE';
  end if;

  update public.print_jobs job
  set status = 'printing', zpl_payload = p_zpl_payload
  where job.id = target_job.id
  returning * into target_job;

  update public.packing_sessions session
  set status = 'printing'
  where session.id = target_session.id
    and session.status in ('print_pending', 'print_failed', 'printing')
  returning session.status into resulting_session_status;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'print_job.claimed', 'print_job', target_job.id::text,
    jsonb_build_object(
      'packing_session_id', target_session.id,
      'attempt_count', target_job.attempt_count,
      'zpl_length', length(p_zpl_payload)
    )
  );

  return query select
    target_job.id, target_session.id, target_job.status,
    coalesce(resulting_session_status, target_session.status),
    target_job.attempt_count, target_job.label_reference;
end;
$function$;

-- close_label_box_batch
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
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_OPERATOR_REQUIRED';
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

-- close_or_cancel_delivery_number
CREATE OR REPLACE FUNCTION public.close_or_cancel_delivery_number(p_delivery_number_id uuid, p_status delivery_status)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target public.delivery_numbers%rowtype;
begin
  if not (private.is_active_app_user() or private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_FORBIDDEN';
  end if;

  if p_status not in ('closed', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_STATUS_INVALID';
  end if;

  select * into target from public.delivery_numbers
  where public.delivery_numbers.id = p_delivery_number_id for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_NOT_FOUND';
  end if;

  if target.status in ('closed', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_TERMINAL';
  end if;

  update public.delivery_numbers set status = p_status where public.delivery_numbers.id = p_delivery_number_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when p_status = 'closed' then 'delivery_number.closed' else 'delivery_number.cancelled' end,
    'delivery_number', p_delivery_number_id::text,
    jsonb_build_object('previous_status', target.status, 'status', p_status)
  );
end;
$function$;

-- complete_print_job
CREATE OR REPLACE FUNCTION public.complete_print_job(p_print_job_id uuid, p_result print_attempt_result, p_printer_name text, p_error_code text DEFAULT NULL::text, p_error_message_safe text DEFAULT NULL::text)
 RETURNS TABLE(print_job_id uuid, packing_session_id uuid, job_status print_job_status, session_status packing_session_status, attempt_no integer, label_reference text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_job public.print_jobs%rowtype;
  target_session public.packing_sessions%rowtype;
  new_attempt_no integer;
  resulting_session_status public.packing_session_status;
begin
  if not (select private.is_active_app_user()) and not (select private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_FORBIDDEN';
  end if;

  if p_printer_name is null or length(trim(p_printer_name)) = 0 then
    raise exception using errcode = 'P0001', message = 'PRINTER_NAME_REQUIRED';
  end if;

  select * into target_job
  from public.print_jobs job
  where job.id = p_print_job_id
  for update;

  if target_job.id is null then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_NOT_FOUND';
  end if;

  select * into target_session
  from public.packing_sessions session
  where session.id = target_job.packing_session_id
  for update;

  if target_session.operator_id <> auth.uid() and not (select private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_FORBIDDEN';
  end if;

  if target_job.status <> 'printing' then
    raise exception using errcode = 'P0001', message = 'PRINT_JOB_NOT_PRINTING';
  end if;

  new_attempt_no := target_job.attempt_count + 1;

  insert into public.print_attempts (
    print_job_id, attempt_no, printer_name, result, error_code, error_message_safe
  ) values (
    target_job.id, new_attempt_no, trim(p_printer_name), p_result,
    case when p_result = 'failed' then p_error_code end,
    case when p_result = 'failed' then p_error_message_safe end
  );

  if p_result = 'sent' then
    update public.print_jobs job
    set status = 'confirmed',
        attempt_count = new_attempt_no,
        sent_at = statement_timestamp(),
        confirmed_at = statement_timestamp()
    where job.id = target_job.id
    returning * into target_job;

    update public.packing_sessions session
    set status = 'confirmed'
    where session.id = target_session.id
    returning session.status into resulting_session_status;
  else
    update public.print_jobs job
    set status = 'failed', attempt_count = new_attempt_no
    where job.id = target_job.id
    returning * into target_job;

    update public.packing_sessions session
    set status = 'print_failed'
    where session.id = target_session.id
    returning session.status into resulting_session_status;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when p_result = 'sent' then 'print_attempt.sent' else 'print_attempt.failed' end,
    'print_job', target_job.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'packing_session_id', target_session.id,
      'attempt_no', new_attempt_no,
      'printer_name', trim(p_printer_name),
      'error_code', p_error_code
    ))
  );

  return query select
    target_job.id, target_session.id, target_job.status,
    resulting_session_status, new_attempt_no, target_job.label_reference;
end;
$function$;

-- create_delivery_number
CREATE OR REPLACE FUNCTION public.create_delivery_number(p_supplier_id uuid, p_delivery_number text, p_delivery_date date, p_status delivery_status DEFAULT 'draft'::delivery_status)
 RETURNS TABLE(id uuid, supplier_id uuid, delivery_number text, delivery_date date, status delivery_status, created_by uuid, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  normalized_number text := upper(btrim(p_delivery_number));
begin
  if not (private.is_active_app_user() or private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_FORBIDDEN';
  end if;

  if normalized_number !~ '^[A-Z0-9][A-Z0-9_/-]{1,99}$'
    or p_delivery_date is null
    or p_status not in ('draft', 'active') then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INPUT_INVALID';
  end if;

  if not exists (
    select 1 from public.suppliers
    where public.suppliers.id = p_supplier_id and public.suppliers.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_SUPPLIER_INVALID';
  end if;

  begin
    insert into public.delivery_numbers (supplier_id, delivery_number, delivery_date, status, created_by)
    values (p_supplier_id, normalized_number, p_delivery_date, p_status, auth.uid())
    returning * into id, supplier_id, delivery_number, delivery_date, status, created_by, created_at, updated_at;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_EXISTS';
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'delivery_number.created', 'delivery_number', id::text,
    jsonb_build_object('supplier_id', supplier_id, 'delivery_number', delivery_number,
      'delivery_date', delivery_date, 'status', status)
  );

  return next;
end;
$function$;

-- create_label_box_batch
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
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_OPERATOR_REQUIRED';
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
    supplier_code_snapshot, item_code_snapshot, delivery_number_snapshot,
    delivery_date_snapshot
  ) values (
    target_dn.id, p_supplier_id, p_master_item_id, computed_row_no,
    target_item.default_label_qty, p_qty_delivery, normalized_lot_no,
    set_count * box_count, generated_at, auth.uid(),
    target_supplier.supplier_code, target_item.item_code, target_dn.delivery_number,
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
$function$;

-- create_label_box_print_jobs
CREATE OR REPLACE FUNCTION public.create_label_box_print_jobs(p_batch_id uuid)
 RETURNS TABLE(print_job_id uuid, label_box_id uuid, box_number text, label_reference text, qr_payload text, supplier_code text, part_no text, part_name text, qty integer, delivery_number text, delivery_date date, box_name text, lot_no text, qty_delivery integer, status print_job_status)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_batch public.label_box_batches%rowtype;
  target_item public.master_items%rowtype;
  pending_box record;
  new_sequence_no bigint;
  new_label_reference text;
begin
  if not private.is_active_app_user() then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_OPERATOR_REQUIRED';
  end if;

  select * into target_batch
  from public.label_box_batches batch
  where batch.id = p_batch_id
  for update;

  if target_batch.id is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_NOT_FOUND';
  end if;

  if target_batch.closed_at is null then
    raise exception using errcode = 'P0001', message = 'LABEL_BOX_BATCH_NOT_CLOSED';
  end if;

  select * into target_item
  from public.master_items item
  where item.id = target_batch.master_item_id;

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
      new_label_reference, 'v3', 'PENDING_ZPL_GENERATION', auth.uid()
    from public.suppliers supplier
    where supplier.id = target_batch.supplier_id;
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'label_box_batch.print_jobs_created', 'label_box_batch',
    p_batch_id::text,
    jsonb_build_object('label_count', target_batch.label_count)
  );

  return query
  select
    job.id, box.id, box.box_number, job.label_reference, job.qr_payload_snapshot,
    job.supplier_code_snapshot, job.part_no_snapshot, job.part_name_snapshot,
    job.qty_snapshot, job.delivery_number_snapshot, job.delivery_date_snapshot,
    job.box_name_snapshot, job.lot_no_snapshot, job.qty_delivery_snapshot,
    job.status
  from public.label_boxes box
  join public.print_jobs job
    on job.packing_session_id = box.packing_session_id
    and job.parent_print_job_id is null
  where box.batch_id = p_batch_id
  order by box.set_no, box.box_no;
end;
$function$;

-- update_delivery_number
CREATE OR REPLACE FUNCTION public.update_delivery_number(p_delivery_number_id uuid, p_supplier_id uuid, p_delivery_number text, p_delivery_date date)
 RETURNS TABLE(id uuid, supplier_id uuid, delivery_number text, delivery_date date, status delivery_status, created_by uuid, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target public.delivery_numbers%rowtype;
  normalized_number text := upper(btrim(p_delivery_number));
begin
  if not (private.is_active_app_user() or private.is_active_admin()) then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_FORBIDDEN';
  end if;

  if normalized_number !~ '^[A-Z0-9][A-Z0-9_/-]{1,99}$'
    or p_delivery_date is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_INPUT_INVALID';
  end if;

  select * into target from public.delivery_numbers
  where public.delivery_numbers.id = p_delivery_number_id for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_NOT_FOUND';
  end if;

  if target.status in ('closed', 'cancelled') then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_TERMINAL';
  end if;

  if not exists (
    select 1 from public.suppliers
    where public.suppliers.id = p_supplier_id and public.suppliers.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_SUPPLIER_INVALID';
  end if;

  begin
    update public.delivery_numbers
    set supplier_id = p_supplier_id, delivery_number = normalized_number, delivery_date = p_delivery_date
    where public.delivery_numbers.id = p_delivery_number_id
    returning * into id, supplier_id, delivery_number, delivery_date, status, created_by, created_at, updated_at;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'DELIVERY_NUMBER_EXISTS';
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'delivery_number.updated', 'delivery_number', id::text,
    jsonb_build_object('supplier_id', supplier_id, 'delivery_number', delivery_number, 'delivery_date', delivery_date)
  );

  return next;
end;
$function$;


-- Peran tinggal admin dan pengguna biasa. Nilai enum diganti nama, bukan
-- dihapus, supaya baris profiles yang ada ikut terbawa tanpa migrasi data.
alter type public.user_role rename value 'operator' to 'user';

notify pgrst, 'reload schema';
