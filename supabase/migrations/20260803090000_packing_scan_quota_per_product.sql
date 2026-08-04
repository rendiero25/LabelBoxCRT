-- Satu layer box boleh memuat beberapa produk berbeda, masing-masing dengan
-- kuotanya sendiri. accept_packing_scan menghitung scan yang sudah diterima
-- per layer, tanpa menyaring produknya, sehingga keping pertama yang masuk
-- memenuhi kuota seluruh produk lain di layer itu dan scan berikutnya ditolak
-- LAYER_QUANTITY_FULL padahal produknya belum pernah discan.
--
-- Terlihat di lapangan pada batch DN-06-2026-12554: layer 1 box B101 memuat
-- tiga produk dengan expected_qty 1, dan setelah satu produk diterima, dua
-- sisanya ikut dianggap penuh.

CREATE OR REPLACE FUNCTION public.accept_packing_scan(p_packing_session_id uuid, p_label_uid text, p_raw_payload_hash text, p_scanned_size text, p_normalized_size text)
 RETURNS TABLE(result scan_result, error_code text, session_id uuid, session_status packing_session_status, product_id uuid, box_layer_id uuid, layer_accepted_qty integer, layer_expected_qty integer, total_accepted_qty integer, total_expected_qty integer, ready_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_session public.packing_sessions%rowtype;
  target_item public.master_items%rowtype;
  target_product public.products%rowtype;
  normalized_label_uid text := nullif(btrim(p_label_uid), '');
  normalized_size text := lower(btrim(p_normalized_size));
  raw_hash text := btrim(p_raw_payload_hash);
  scan_result_value public.scan_result;
  scan_error_code text;
  selected_box_layer_id uuid;
  selected_layer_expected_qty integer;
  selected_layer_accepted_qty integer := 0;
  selected_product_id uuid;
  expected_total integer;
  accepted_total integer;
  resulting_status public.packing_session_status;
  resulting_ready_at timestamptz;
  scan_correlation_id uuid := gen_random_uuid();
begin
  if raw_hash is null
    or raw_hash = ''
    or p_scanned_size is null
    or btrim(p_scanned_size) = ''
    or normalized_size is null
    or normalized_size = '' then
    raise exception using errcode = 'P0001', message = 'SCAN_INPUT_INVALID';
  end if;

  select * into target_session
  from public.packing_sessions session
  where session.id = p_packing_session_id
  for update;

  if target_session.id is null then
    raise exception using errcode = 'P0001', message = 'PACKING_SESSION_NOT_FOUND';
  end if;

  if target_session.operator_id <> auth.uid() then
    raise exception using errcode = 'P0001', message = 'PACKING_SESSION_OPERATOR_MISMATCH';
  end if;

  if target_session.status <> 'scanning' then
    raise exception using errcode = 'P0001', message = 'SESSION_NOT_ACCEPTING_SCAN';
  end if;

  select * into target_item
  from public.master_items item
  where item.id = target_session.master_item_id and item.is_active;

  if target_item.id is null then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_NOT_ACTIVE';
  end if;

  select coalesce(sum(requirement.expected_qty), 0)::integer into expected_total
  from public.box_layer_requirements requirement
  join public.box_layers layer on layer.id = requirement.box_layer_id
  where layer.box_id = target_session.box_id;

  if expected_total <= 0 then
    raise exception using errcode = 'P0001', message = 'SESSION_BOX_INVALID';
  end if;

  select count(*)::integer into accepted_total
  from public.packing_session_scans scan
  where scan.packing_session_id = target_session.id
    and scan.result = 'accepted';

  if normalized_label_uid is null
    or normalized_label_uid ~ '[[:cntrl:]]'
    or char_length(normalized_label_uid) > 256 then
    scan_result_value := 'invalid';
    scan_error_code := case
      when normalized_label_uid is null then 'LABEL_UID_MISSING'
      else 'LABEL_UID_INVALID'
    end;
  elsif exists (
    select 1 from public.packing_session_scans scan
    where scan.label_uid = normalized_label_uid and scan.result = 'accepted'
  ) then
    scan_result_value := 'duplicate';
    scan_error_code := 'LABEL_ALREADY_SCANNED';
  else
    select product.* into target_product
    from public.products product
    join public.master_item_products mapping
      on mapping.product_id = product.id
      and mapping.master_item_id = target_session.master_item_id
      and mapping.is_active
    where product.normalized_dimensions = normalized_size
      and product.is_active
    order by product.id
    limit 1;

    if target_product.id is null then
      select product.* into target_product
      from public.products product
      where product.normalized_dimensions = normalized_size
        and product.is_active
      order by product.id
      limit 1;

      if target_product.id is null then
        scan_result_value := 'invalid';
        scan_error_code := 'PRODUCT_SIZE_NOT_FOUND';
      else
        selected_product_id := target_product.id;
        scan_result_value := 'invalid';
        scan_error_code := 'PRODUCT_NOT_ALLOWED_FOR_PART';
      end if;
    else
      selected_product_id := target_product.id;

      select
        requirement.box_layer_id, requirement.expected_qty, count(scan.id)::integer
      into
        selected_box_layer_id, selected_layer_expected_qty, selected_layer_accepted_qty
      from public.box_layer_requirements requirement
      join public.box_layers layer on layer.id = requirement.box_layer_id
      left join public.packing_session_scans scan
        on scan.packing_session_id = target_session.id
        and scan.box_layer_id = requirement.box_layer_id
        and scan.product_id = requirement.product_id
        and scan.result = 'accepted'
      where layer.box_id = target_session.box_id
        and requirement.product_id = target_product.id
      group by requirement.box_layer_id, requirement.expected_qty,
        layer.sort_order, requirement.sort_order
      having count(scan.id) < requirement.expected_qty
      order by layer.sort_order, requirement.sort_order
      limit 1;

      if selected_box_layer_id is not null then
        scan_result_value := 'accepted';
        scan_error_code := null;
      elsif exists (
        select 1
        from public.box_layer_requirements requirement
        join public.box_layers layer on layer.id = requirement.box_layer_id
        where layer.box_id = target_session.box_id
          and requirement.product_id = target_product.id
      ) then
        scan_result_value := 'over_qty';
        scan_error_code := 'LAYER_QUANTITY_FULL';
      else
        scan_result_value := 'invalid';
        scan_error_code := 'PRODUCT_NOT_REQUIRED_IN_BOX';
      end if;
    end if;
  end if;

  if scan_result_value = 'accepted' then
    begin
      insert into public.packing_session_scans (
        packing_session_id, label_uid, raw_payload_hash, scanned_part_no,
        scanned_size, normalized_size, product_id, box_layer_id, result,
        scanned_by, correlation_id
      ) values (
        target_session.id, normalized_label_uid, raw_hash, target_item.part_no,
        btrim(p_scanned_size), normalized_size, selected_product_id,
        selected_box_layer_id, 'accepted', auth.uid(), scan_correlation_id
      );
    exception when unique_violation then
      scan_result_value := 'duplicate';
      scan_error_code := 'LABEL_ALREADY_SCANNED';
      selected_box_layer_id := null;
      selected_layer_expected_qty := null;
      selected_layer_accepted_qty := 0;
    end;
  end if;

  if scan_result_value <> 'accepted' then
    insert into public.packing_session_scans (
      packing_session_id, label_uid, raw_payload_hash, scanned_part_no,
      scanned_size, normalized_size, product_id, box_layer_id, result,
      error_code, scanned_by, correlation_id
    ) values (
      target_session.id, normalized_label_uid, raw_hash, target_item.part_no,
      btrim(p_scanned_size), normalized_size, selected_product_id, null,
      scan_result_value, scan_error_code, auth.uid(), scan_correlation_id
    );
  end if;

  if scan_result_value = 'accepted' then
    selected_layer_accepted_qty := selected_layer_accepted_qty + 1;

    select count(*)::integer into accepted_total
    from public.packing_session_scans scan
    where scan.packing_session_id = target_session.id
      and scan.result = 'accepted';

    if accepted_total = expected_total then
      update public.packing_sessions session
      set status = 'ready_to_finalize', ready_at = statement_timestamp()
      where session.id = target_session.id
        and session.status = 'scanning'
      returning session.status, session.ready_at
      into resulting_status, resulting_ready_at;
    else
      resulting_status := target_session.status;
      resulting_ready_at := target_session.ready_at;
    end if;
  else
    resulting_status := target_session.status;
    resulting_ready_at := target_session.ready_at;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata, correlation_id)
  values (
    auth.uid(),
    case when scan_result_value = 'accepted' then 'packing_scan.accepted' else 'packing_scan.rejected' end,
    'packing_session_scan', target_session.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'result', scan_result_value::text,
      'error_code', scan_error_code,
      'product_id', selected_product_id,
      'box_layer_id', selected_box_layer_id,
      'raw_payload_hash', raw_hash,
      'total_accepted_qty', accepted_total,
      'total_expected_qty', expected_total
    )),
    scan_correlation_id
  );

  return query
  select
    scan_result_value, scan_error_code, target_session.id, resulting_status,
    selected_product_id, selected_box_layer_id, selected_layer_accepted_qty,
    selected_layer_expected_qty, accepted_total, expected_total, resulting_ready_at;
end;
$function$
;

notify pgrst, 'reload schema';
