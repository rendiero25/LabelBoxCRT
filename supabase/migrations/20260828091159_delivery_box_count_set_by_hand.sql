-- Jumlah box diisi operator, bukan diturunkan dari MPQ.
--
-- Sejak 20260828025319 jumlah box dihitung `ceil(Qty Delivery / MPQ)`. Cara itu
-- dilepas: yang tahu berapa box sungguh berangkat adalah orang yang mengemasnya,
-- dan MPQ cuma batas atas -- box boleh diisi kurang, dan satu kiriman bisa
-- dipecah tidak rata. Menurunkannya dari MPQ berarti menebak, dan tebakan itu
-- menolak scan yang benar.
--
-- Sekarang: file diunggah, barisnya muncul dengan kolom Box kosong, operator
-- mengisinya, lalu menembak label sebanyak angka itu. Baris yang Box-nya belum
-- diisi tidak bisa discan sama sekali dan menahan session tetap terbuka --
-- sama seperti dulu ketika MPQ-nya belum ada.
--
-- MPQ Sheet sendiri tidak disentuh. Daftarnya tetap ada beserta seluruh RPC
-- adminnya; yang berhenti cuma pemakaiannya oleh verifikasi pengiriman.

-- Constraint lama menyebut mpq_qty, jadi ia dibuang lebih dulu.
alter table public.delivery_schedule_rows
  drop constraint delivery_schedule_rows_verified_boxes_range;

-- Nilai yang sudah ada dipindahkan apa adanya: baris yang sudah diperiksa
-- dengan jumlah box hasil hitungan MPQ tetap memegang angka itu. Menghitung
-- ulang atau mengosongkannya akan membatalkan pemeriksaan yang sungguh terjadi.
alter table public.delivery_schedule_rows
  add column expected_box_count integer;

update public.delivery_schedule_rows
set expected_box_count = expected_boxes;

alter table public.delivery_schedule_rows
  drop column expected_boxes,
  drop column mpq_qty;

alter table public.delivery_schedule_rows
  rename column expected_box_count to expected_boxes;

-- Box kosong berarti belum diisi, bukan nol. Nol akan terbaca sebagai "tidak
-- butuh box sama sekali" dan melunasi barisnya tanpa satu pun scan.
alter table public.delivery_schedule_rows
  add constraint delivery_schedule_rows_expected_boxes_positive
    check (expected_boxes is null or expected_boxes > 0),
  add constraint delivery_schedule_rows_verified_boxes_range check (
    verified_boxes >= 0
    and (
      case
        when expected_boxes is null then verified_boxes = 0
        else verified_boxes <= expected_boxes
      end
    )
  );

-- Tidak ada lagi MPQ yang bisa terlambat, jadi tombol pengisinya ikut pergi.
drop function if exists public.refresh_delivery_schedule_mpq(uuid);

/**
 * Menambah baris Schedule Delivery dari satu file.
 *
 * Jumlah box sengaja tidak diisi di sini. Yang tahu berapa box sungguh
 * berangkat adalah orang yang mengemasnya, dan dokumen jadwal tidak
 * menyebutkannya.
 */
drop function if exists public.add_delivery_schedule_rows(uuid, text, jsonb);

create function public.add_delivery_schedule_rows(
  p_session_id uuid,
  p_source_file_name text,
  p_rows jsonb
)
returns table (
  id uuid,
  row_no integer,
  customer text,
  product_size text,
  qty_delivery integer,
  expected_boxes integer,
  source_file_name text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_session public.delivery_verification_sessions%rowtype;
  normalized_file text := btrim(coalesce(p_source_file_name, ''));
  next_row_no integer;
  row_count integer;
begin
  if not private.is_active_app_user() then
    raise exception using errcode = 'P0001', message = 'ACTIVE_USER_REQUIRED';
  end if;

  select * into target_session
  from public.delivery_verification_sessions session
  where session.id = p_session_id;

  if target_session.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_SESSION_NOT_FOUND';
  end if;

  if target_session.status <> 'open' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_SESSION_CLOSED';
  end if;

  if normalized_file = '' or char_length(normalized_file) > 255 then
    raise exception using errcode = 'P0001', message = 'DELIVERY_SOURCE_FILE_INVALID';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_ROWS_INVALID';
  end if;

  if jsonb_array_length(p_rows) = 0 then
    raise exception using errcode = 'P0001', message = 'DELIVERY_ROWS_EMPTY';
  end if;

  select count(*)::integer into row_count
  from jsonb_array_elements(p_rows) as entry
  where coalesce(btrim(entry.value ->> 'productSize'), '') <> ''
    and (entry.value ->> 'qty') ~ '^[1-9][0-9]{0,6}$';

  if row_count <> jsonb_array_length(p_rows) then
    raise exception using errcode = 'P0001', message = 'DELIVERY_ROWS_INVALID';
  end if;

  select coalesce(max(existing.row_no), 0) + 1 into next_row_no
  from public.delivery_schedule_rows existing
  where existing.session_id = p_session_id;

  return query
  insert into public.delivery_schedule_rows (
    session_id, row_no, customer, product_size, qty_delivery, source_file_name
  )
  select
    p_session_id,
    next_row_no + (entry.ordinality::integer - 1),
    nullif(btrim(coalesce(entry.value ->> 'customer', '')), ''),
    upper(regexp_replace(btrim(entry.value ->> 'productSize'), '\s+', ' ', 'g')),
    (entry.value ->> 'qty')::integer,
    normalized_file
  from jsonb_array_elements(p_rows) with ordinality as entry(value, ordinality)
  returning
    public.delivery_schedule_rows.id,
    public.delivery_schedule_rows.row_no,
    public.delivery_schedule_rows.customer,
    public.delivery_schedule_rows.product_size,
    public.delivery_schedule_rows.qty_delivery,
    public.delivery_schedule_rows.expected_boxes,
    public.delivery_schedule_rows.source_file_name,
    public.delivery_schedule_rows.created_at;
end;
$$;

revoke execute on function public.add_delivery_schedule_rows(uuid, text, jsonb)
  from public, anon;
grant execute on function public.add_delivery_schedule_rows(uuid, text, jsonb)
  to authenticated;

/**
 * Mengisi jumlah box satu baris jadwal.
 *
 * Boleh diubah selama session masih terbuka, tetapi tidak boleh turun di bawah
 * box yang sudah discan: angka yang lebih kecil dari itu berarti mengaku telah
 * memeriksa box yang tidak ada. Untuk mengoreksi ke bawah, barisnya dibuang dan
 * jadwalnya diunggah ulang.
 *
 * Menaikkannya tetap boleh -- operator menemukan satu box lagi di palet, dan
 * baris yang sudah lunas kembali kurang. Karena itu verified_at ikut dihitung
 * ulang di sini, bukan dibiarkan menggantung dari keadaan sebelumnya.
 */
create function public.set_delivery_schedule_row_boxes(
  p_row_id uuid,
  p_expected_boxes integer
)
returns table (
  id uuid,
  row_no integer,
  expected_boxes integer,
  verified_boxes integer,
  verified_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_row public.delivery_schedule_rows%rowtype;
  target_session public.delivery_verification_sessions%rowtype;
begin
  if not private.is_active_app_user() then
    raise exception using errcode = 'P0001', message = 'ACTIVE_USER_REQUIRED';
  end if;

  select * into target_row
  from public.delivery_schedule_rows schedule_row
  where schedule_row.id = p_row_id;

  if target_row.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_ROW_NOT_FOUND';
  end if;

  select * into target_session
  from public.delivery_verification_sessions session
  where session.id = target_row.session_id;

  if target_session.status <> 'open' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_SESSION_CLOSED';
  end if;

  -- Batas atasnya longgar: yang dijaga cuma bahwa angkanya masuk akal sebagai
  -- jumlah box, bukan berapa banyak box yang pantas untuk Qty sebesar itu.
  -- Aturan terakhir itulah yang baru saja dilepas.
  if p_expected_boxes is null
    or p_expected_boxes < 1
    or p_expected_boxes > 9999 then
    raise exception using errcode = 'P0001', message = 'DELIVERY_BOXES_INVALID';
  end if;

  if p_expected_boxes < target_row.verified_boxes then
    raise exception using errcode = 'P0001', message = 'DELIVERY_BOXES_BELOW_SCANNED';
  end if;

  update public.delivery_schedule_rows
  set
    expected_boxes = p_expected_boxes,
    -- Dibaca dari salinan barisnya, bukan dari nama kolomnya: `verified_at`
    -- juga nama kolom balikan fungsi ini, dan Postgres tidak bisa menebak yang
    -- mana yang dimaksud.
    verified_at = case
      when target_row.verified_boxes >= p_expected_boxes
      then coalesce(target_row.verified_at, now())
      else null
    end
  where public.delivery_schedule_rows.id = p_row_id
  returning * into target_row;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'delivery_schedule_row.boxes_set', 'delivery_schedule_row',
    target_row.id::text,
    jsonb_build_object(
      'session_no', target_session.session_no,
      'row_no', target_row.row_no,
      'product_size', target_row.product_size,
      'expected_boxes', target_row.expected_boxes
    )
  );

  return query
  select
    target_row.id, target_row.row_no, target_row.expected_boxes,
    target_row.verified_boxes, target_row.verified_at;
end;
$$;

revoke execute on function public.set_delivery_schedule_row_boxes(uuid, integer)
  from public, anon;
grant execute on function public.set_delivery_schedule_row_boxes(uuid, integer)
  to authenticated;

/**
 * Mencocokkan satu hasil scan dengan jadwal.
 *
 * Sama seperti sebelumnya -- ukuran dari field kedua, Qty Delivery dari field
 * ketiga, dan tiap scan yang diterima menghitung satu box -- kecuali jumlah box
 * sekarang datang dari isian operator. Baris yang Box-nya belum diisi tidak
 * bisa dicocokkan, dan penolakannya dibedakan lewat `boxes_unset` supaya
 * operator tahu yang kurang isian di layar, bukan labelnya.
 */
drop function if exists public.verify_delivery_label(uuid, text);

create function public.verify_delivery_label(
  p_session_id uuid,
  p_qr_payload text
)
returns table (
  result public.delivery_scan_result,
  matched_row_id uuid,
  matched_row_no integer,
  product_size text,
  qty_delivery integer,
  expected_boxes integer,
  verified_boxes integer,
  row_done boolean,
  size_complete boolean,
  boxes_unset boolean,
  expected_qty integer,
  part_no text,
  packing_qty integer,
  verified_count integer,
  total_count integer,
  delivery_ok boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_session public.delivery_verification_sessions%rowtype;
  matched public.delivery_schedule_rows%rowtype;
  explainer public.delivery_schedule_rows%rowtype;
  scan_result public.delivery_scan_result;
  normalized_payload text := btrim(coalesce(p_qr_payload, ''));
  payload_fields text[];
  label_part_no text;
  label_part_no_key text;
  label_qty_text text;
  label_qty integer;
  boxes_total integer;
  boxes_done integer;
  rows_total integer;
  rows_left integer;
  out_size_complete boolean := false;
  out_boxes_unset boolean := false;
  out_expected_qty integer;
begin
  if not private.is_active_app_user() then
    raise exception using errcode = 'P0001', message = 'ACTIVE_USER_REQUIRED';
  end if;

  select * into target_session
  from public.delivery_verification_sessions session
  where session.id = p_session_id;

  if target_session.id is null then
    raise exception using errcode = 'P0001', message = 'DELIVERY_SESSION_NOT_FOUND';
  end if;

  if target_session.status <> 'open' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_SESSION_CLOSED';
  end if;

  if normalized_payload = '' then
    raise exception using errcode = 'P0001', message = 'DELIVERY_SCAN_EMPTY';
  end if;

  payload_fields := string_to_array(normalized_payload, '|');

  if coalesce(array_length(payload_fields, 1), 0) >= 3 then
    label_part_no := regexp_replace(
      upper(btrim(payload_fields[2])), '\s+', ' ', 'g'
    );
    label_part_no_key := regexp_replace(upper(payload_fields[2]), '\s', '', 'g');
    label_qty_text := btrim(payload_fields[3]);
  end if;

  if coalesce(label_part_no_key, '') = ''
    or coalesce(label_qty_text, '') !~ '^[0-9]{1,9}$'
    or label_qty_text::integer <= 0 then
    scan_result := 'unknown_label';
    label_part_no := null;
    label_qty := null;
  else
    label_qty := label_qty_text::integer;

    select schedule_row.* into matched
    from public.delivery_schedule_rows schedule_row
    where schedule_row.session_id = p_session_id
      and regexp_replace(upper(schedule_row.product_size), '\s', '', 'g')
        = label_part_no_key
      and schedule_row.expected_boxes is not null
      and schedule_row.qty_delivery = label_qty
      and schedule_row.verified_boxes < schedule_row.expected_boxes
    order by schedule_row.row_no
    limit 1;

    if matched.id is null then
      scan_result := 'not_pass';

      select schedule_row.* into explainer
      from public.delivery_schedule_rows schedule_row
      where schedule_row.session_id = p_session_id
        and regexp_replace(upper(schedule_row.product_size), '\s', '', 'g')
          = label_part_no_key
      order by
        (
          schedule_row.expected_boxes is null
          or schedule_row.verified_boxes < schedule_row.expected_boxes
        ) desc,
        (schedule_row.expected_boxes is null) desc,
        schedule_row.row_no
      limit 1;

      if explainer.id is not null then
        out_boxes_unset := explainer.expected_boxes is null;
        out_size_complete := not out_boxes_unset
          and explainer.verified_boxes >= explainer.expected_boxes;
        out_expected_qty := explainer.qty_delivery;
      end if;
    else
      update public.delivery_schedule_rows
      set
        verified_boxes = matched.verified_boxes + 1,
        verified_at = case
          when matched.verified_boxes + 1 >= matched.expected_boxes
          then now()
          else null
        end
      where public.delivery_schedule_rows.id = matched.id
      returning * into matched;

      scan_result := 'pass';
    end if;
  end if;

  insert into public.delivery_verification_scans (
    session_id, qr_payload, result, matched_row_id, label_box_id, scanned_by
  ) values (
    p_session_id, normalized_payload, scan_result, matched.id, null, auth.uid()
  );

  -- Baris yang Box-nya belum diisi tidak menyumbang ke hitungan box, tetapi
  -- tetap terhitung sebagai baris yang belum lunas.
  select
    count(*)::integer,
    count(*) filter (
      where schedule_row.expected_boxes is null
        or schedule_row.verified_boxes < schedule_row.expected_boxes
    )::integer,
    coalesce(sum(schedule_row.expected_boxes), 0)::integer,
    coalesce(sum(schedule_row.verified_boxes), 0)::integer
  into rows_total, rows_left, boxes_total, boxes_done
  from public.delivery_schedule_rows schedule_row
  where schedule_row.session_id = p_session_id;

  if rows_total > 0 and rows_left = 0 then
    update public.delivery_verification_sessions
    set status = 'done', closed_at = now()
    where public.delivery_verification_sessions.id = p_session_id;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (
      auth.uid(), 'delivery_verification_session.completed',
      'delivery_verification_session', p_session_id::text,
      jsonb_build_object('session_no', target_session.session_no, 'box_count', boxes_total)
    );
  end if;

  return query
  select
    scan_result,
    matched.id,
    matched.row_no,
    coalesce(matched.product_size, explainer.product_size),
    coalesce(matched.qty_delivery, explainer.qty_delivery),
    coalesce(matched.expected_boxes, explainer.expected_boxes),
    coalesce(matched.verified_boxes, explainer.verified_boxes),
    (matched.id is not null and matched.verified_at is not null),
    out_size_complete,
    out_boxes_unset,
    out_expected_qty,
    label_part_no,
    label_qty,
    boxes_done,
    boxes_total,
    (rows_total > 0 and rows_left = 0);
end;
$$;

revoke execute on function public.verify_delivery_label(uuid, text)
  from public, anon;
grant execute on function public.verify_delivery_label(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
