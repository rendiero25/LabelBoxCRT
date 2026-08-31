-- Baris lunas ketika jumlah Qty yang discan mencapai Qty Delivery.
--
-- Label membawa Qty box yang dipegang, bukan Qty Delivery. Operator menembak
-- box demi box dan angkanya dijumlahkan; barisnya lunas saat totalnya sama
-- dengan Qty Delivery. Berapa box yang dipakai tidak diatur -- kiriman 5000
-- boleh datang sebagai dua box 2500 atau lima box 1000 -- dan jumlah box hanya
-- ditampilkan sebagai keterangan.
--
-- Buktinya ada di catatan scan: Session 4 ukuran VS-B T0.3XW100 L=185MM
-- ber-Qty Delivery 3000 ditembak tiga kali dengan label ber-Qty 1500 dan
-- ditolak semua. Itu label per-box yang benar, ditolak aturan yang salah.
--
-- Scan berulang berangka sama persis dengan Qty Delivery yang memenuhi Session
-- 15 dan 18 bukan bukti sebaliknya: itu operator menembak satu label berkali-
-- kali demi memenuhi jumlah box yang diminta aturan sebelumnya. Data yang
-- dihasilkan sebuah aturan tidak bisa dipakai membenarkan aturan itu.
--
-- Yang hilang: expected_boxes beserta isiannya. Angka itu tidak lagi
-- menentukan apa pun, dan mengetiknya cuma pekerjaan tambahan yang bisa salah.

alter table public.delivery_schedule_rows
  drop constraint delivery_schedule_rows_verified_boxes_range;

alter table public.delivery_schedule_rows
  drop constraint delivery_schedule_rows_expected_boxes_positive;

-- Jumlah keping yang sudah masuk. Inilah yang menentukan lunas; verified_boxes
-- tinggal keterangan berapa kali ditembak.
alter table public.delivery_schedule_rows
  add column verified_qty integer not null default 0;

-- Baris yang sudah lunas di bawah aturan lama tetap lunas. Yang belum diisi
-- ulang dari nol: jumlah kepingnya tidak bisa dipulihkan dari catatan scan --
-- payload-nya berisi angka yang diterima aturan lama, bukan isi box sungguhan.
update public.delivery_schedule_rows
set verified_qty = case when verified_at is null then 0 else qty_delivery end;

alter table public.delivery_schedule_rows
  drop column expected_boxes;

alter table public.delivery_schedule_rows
  add constraint delivery_schedule_rows_verified_qty_range
    check (verified_qty >= 0 and verified_qty <= qty_delivery),
  add constraint delivery_schedule_rows_verified_boxes_positive
    check (verified_boxes >= 0);

drop function if exists public.set_delivery_schedule_row_boxes(uuid, integer);

/**
 * Menambah baris Schedule Delivery dari satu file.
 *
 * Sama seperti sebelumnya; yang berubah hanya kolom yang dikembalikan, sebab
 * expected_boxes sudah tidak ada.
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
    public.delivery_schedule_rows.source_file_name,
    public.delivery_schedule_rows.created_at;
end;
$$;

revoke execute on function public.add_delivery_schedule_rows(uuid, text, jsonb)
  from public, anon;
grant execute on function public.add_delivery_schedule_rows(uuid, text, jsonb)
  to authenticated;

/**
 * Mencocokkan satu hasil scan dengan jadwal.
 *
 * Ukuran dari field kedua payload, Qty box dari field ketiga. Scan diterima
 * kalau ada baris berukuran sama yang belum lunas dan Qty-nya masih muat pada
 * sisa baris itu. Qty yang melebihi sisa ditolak: menerimanya berarti kiriman
 * tercatat lebih banyak daripada yang dijadwalkan, dan selisihnya tidak akan
 * pernah ketahuan dari tabel.
 *
 * Baris dengan sisa terkecil didahulukan, supaya dua kiriman berukuran sama
 * diselesaikan satu per satu alih-alih terisi separuh-separuh.
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
  verified_qty integer,
  verified_boxes integer,
  remaining_qty integer,
  row_done boolean,
  size_complete boolean,
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
  qty_total integer;
  qty_done integer;
  rows_total integer;
  rows_left integer;
  out_size_complete boolean := false;
  out_remaining_qty integer;
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
      and schedule_row.verified_qty + label_qty <= schedule_row.qty_delivery
    order by
      (schedule_row.qty_delivery - schedule_row.verified_qty),
      schedule_row.row_no
    limit 1;

    if matched.id is null then
      scan_result := 'not_pass';

      -- Baris berukuran sama tetap dicari untuk menjelaskan penolakannya.
      -- Yang belum lunas didahulukan; di antaranya yang sisanya paling besar,
      -- sebab itu yang paling mungkin dimaksud operator.
      select schedule_row.* into explainer
      from public.delivery_schedule_rows schedule_row
      where schedule_row.session_id = p_session_id
        and regexp_replace(upper(schedule_row.product_size), '\s', '', 'g')
          = label_part_no_key
      order by
        (schedule_row.verified_qty < schedule_row.qty_delivery) desc,
        (schedule_row.qty_delivery - schedule_row.verified_qty) desc,
        schedule_row.row_no
      limit 1;

      if explainer.id is not null then
        out_remaining_qty := explainer.qty_delivery - explainer.verified_qty;
        out_size_complete := out_remaining_qty <= 0;
      end if;
    else
      update public.delivery_schedule_rows
      set
        verified_qty = matched.verified_qty + label_qty,
        verified_boxes = matched.verified_boxes + 1,
        verified_at = case
          when matched.verified_qty + label_qty >= matched.qty_delivery
          then now()
          else null
        end
      where public.delivery_schedule_rows.id = matched.id
      returning * into matched;

      out_remaining_qty := matched.qty_delivery - matched.verified_qty;
    end if;

    if matched.id is not null then
      scan_result := 'pass';
    end if;
  end if;

  insert into public.delivery_verification_scans (
    session_id, qr_payload, result, matched_row_id, label_box_id, scanned_by
  ) values (
    p_session_id, normalized_payload, scan_result, matched.id, null, auth.uid()
  );

  -- Hitungannya keping, bukan box: berapa box yang dipakai tidak diatur, jadi
  -- "8/12 box" tidak menjawab apa pun tentang kemajuan kiriman.
  select
    count(*)::integer,
    count(*) filter (
      where schedule_row.verified_qty < schedule_row.qty_delivery
    )::integer,
    coalesce(sum(schedule_row.qty_delivery), 0)::integer,
    coalesce(sum(schedule_row.verified_qty), 0)::integer
  into rows_total, rows_left, qty_total, qty_done
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
      jsonb_build_object('session_no', target_session.session_no, 'qty_total', qty_total)
    );
  end if;

  return query
  select
    scan_result,
    matched.id,
    matched.row_no,
    coalesce(matched.product_size, explainer.product_size),
    coalesce(matched.qty_delivery, explainer.qty_delivery),
    coalesce(matched.verified_qty, explainer.verified_qty),
    coalesce(matched.verified_boxes, explainer.verified_boxes),
    out_remaining_qty,
    (matched.id is not null and matched.verified_at is not null),
    out_size_complete,
    label_part_no,
    label_qty,
    qty_done,
    qty_total,
    (rows_total > 0 and rows_left = 0);
end;
$$;

revoke execute on function public.verify_delivery_label(uuid, text)
  from public, anon;
grant execute on function public.verify_delivery_label(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
