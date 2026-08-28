-- Customer ikut ke jadwal, dan ukuran tanpa MPQ ditandai alih-alih ditolak.
--
-- Dokumen jadwal yang dipakai seterusnya adalah DO Report: satu file memuat
-- seluruh divisi dan seluruh customer untuk rentang tanggalnya, dengan kolom
-- Customer, Item No (ukuran sheet), dan Qty (Qty Delivery). Penyaringan divisi
-- dikerjakan parser; yang berubah di sini dua hal.
--
-- Pertama, Customer disimpan per baris. Satu file memuat beberapa customer
-- sekaligus, dan tanpa kolomnya operator tidak bisa tahu kiriman siapa yang
-- sedang ia periksa.
--
-- Kedua, ukuran sheet yang belum ada di MPQ Sheet tidak lagi menggagalkan
-- seluruh file. Alasannya datang dari dokumen nyata: dari 13 baris sheet pada
-- DO Report 21 Agustus 2026, delapan belum punya MPQ -- empat di antaranya
-- VS-B milik CIPTA MANDIRI yang memang dikirim rutin. Daftar MPQ 2021
-- ketinggalan dari yang berjalan sekarang, jadi menolak seluruh file berarti
-- tidak ada satu pun jadwal yang bisa diunggah sampai daftarnya dikejar.
--
-- Yang diambil sebagai gantinya: barisnya masuk dengan mpq_qty null, terlihat
-- di tabel sebagai "MPQ belum ada", dan scan-nya ditolak dengan sebab itu.
-- Baris semacam itu tidak pernah lunas, jadi session-nya tidak bisa DELIVERY OK
-- sebelum MPQ-nya ditambahkan -- kurangnya terlihat, bukan hilang.

alter table public.delivery_schedule_rows
  add column customer text
    check (customer is null or btrim(customer) <> '');

alter table public.delivery_schedule_rows alter column mpq_qty drop not null;

alter table public.delivery_schedule_rows
  drop constraint delivery_schedule_rows_mpq_positive;

alter table public.delivery_schedule_rows
  add constraint delivery_schedule_rows_mpq_positive
    check (mpq_qty is null or mpq_qty > 0);

-- Ekspresi kolom turunan tidak bisa diubah di tempat, jadi keduanya dibangun
-- ulang. Tanpa MPQ jumlah box tidak diketahui, dan itu ditulis sebagai null --
-- bukan 0, yang akan terbaca sebagai "tidak butuh box sama sekali", dan bukan
-- 1, yang akan membuat kiriman 7500 keping lunas oleh satu label.
alter table public.delivery_schedule_rows
  drop column expected_boxes,
  drop column verified_boxes;

alter table public.delivery_schedule_rows
  add column expected_boxes integer generated always as (
    case
      when mpq_qty is null then null
      else qty_delivery / mpq_qty
        + case when qty_delivery % mpq_qty > 0 then 1 else 0 end
    end
  ) stored,
  add column verified_boxes integer generated always as (
    case
      when mpq_qty is null then null
      else verified_qty / mpq_qty
        + case when verified_qty % mpq_qty > 0 then 1 else 0 end
    end
  ) stored;

/**
 * Menambah baris Schedule Delivery dari satu file.
 *
 * Customer dan Qty Delivery datang dari file; MPQ dicari di MPQ Sheet dan boleh
 * tidak ketemu. Ukuran yang belum punya MPQ tetap masuk dengan mpq_qty null,
 * sebab yang paling mahal bukan baris yang belum bisa discan melainkan baris
 * yang tidak ada sama sekali di jadwal.
 *
 * Part No yang sudah ada tetap tidak ditolak maupun ditimpa: dua kiriman ukuran
 * sama adalah dua baris jadwal, masing-masing dengan jumlah box sendiri.
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
  mpq_qty integer,
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

  -- Ukuran dicocokkan ke MPQ Sheet tanpa spasi, sama seperti saat scan: dokumen
  -- jadwal dan dokumen MPQ diketik terpisah dan tidak sepakat soal spasi
  -- sebelum "MM".
  return query
  insert into public.delivery_schedule_rows (
    session_id, row_no, customer, product_size, qty_delivery, mpq_qty,
    source_file_name
  )
  select
    p_session_id,
    next_row_no + (entry.ordinality::integer - 1),
    nullif(btrim(coalesce(entry.value ->> 'customer', '')), ''),
    upper(regexp_replace(btrim(entry.value ->> 'productSize'), '\s+', ' ', 'g')),
    (entry.value ->> 'qty')::integer,
    (
      select mpq.mpq_qty from public.mpq_sheet_rows mpq
      where mpq.product_size_key
        = regexp_replace(upper(entry.value ->> 'productSize'), '\s', '', 'g')
    ),
    normalized_file
  from jsonb_array_elements(p_rows) with ordinality as entry(value, ordinality)
  returning
    public.delivery_schedule_rows.id,
    public.delivery_schedule_rows.row_no,
    public.delivery_schedule_rows.customer,
    public.delivery_schedule_rows.product_size,
    public.delivery_schedule_rows.qty_delivery,
    public.delivery_schedule_rows.mpq_qty,
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
 * Mencocokkan satu hasil scan dengan jadwal.
 *
 * Sama seperti sebelumnya, kecuali baris tanpa MPQ tidak bisa dicocokkan sama
 * sekali: jumlah box-nya tidak diketahui, jadi tidak ada Qty yang bisa disebut
 * sah. Penolakannya dibedakan lewat `mpq_missing` supaya operator tahu yang
 * kurang adalah data master, bukan labelnya -- dan tahu bahwa menembak ulang
 * tidak akan menolong.
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
  mpq_qty integer,
  expected_boxes integer,
  verified_boxes integer,
  row_done boolean,
  size_complete boolean,
  mpq_missing boolean,
  full_box_qty integer,
  last_box_qty integer,
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
  candidate public.delivery_schedule_rows%rowtype;
  explainer public.delivery_schedule_rows%rowtype;
  scan_result public.delivery_scan_result;
  normalized_payload text := btrim(coalesce(p_qr_payload, ''));
  payload_fields text[];
  label_part_no text;
  label_part_no_key text;
  label_qty_text text;
  label_qty integer;
  full_needed integer;
  full_taken integer;
  remainder integer;
  boxes_total integer;
  boxes_done integer;
  rows_total integer;
  rows_left integer;
  out_size_complete boolean := false;
  out_mpq_missing boolean := false;
  out_full_box_qty integer;
  out_last_box_qty integer;
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

    for candidate in
      select schedule_row.*
      from public.delivery_schedule_rows schedule_row
      where schedule_row.session_id = p_session_id
        and regexp_replace(upper(schedule_row.product_size), '\s', '', 'g')
          = label_part_no_key
        and schedule_row.mpq_qty is not null
        and schedule_row.verified_qty < schedule_row.qty_delivery
      order by schedule_row.row_no
    loop
      full_needed := candidate.qty_delivery / candidate.mpq_qty;
      full_taken := candidate.verified_qty / candidate.mpq_qty;
      remainder := candidate.qty_delivery % candidate.mpq_qty;

      if label_qty = candidate.mpq_qty and full_taken < full_needed then
        matched := candidate;
        exit;
      end if;

      if remainder > 0
        and label_qty = remainder
        and candidate.verified_qty % candidate.mpq_qty = 0 then
        matched := candidate;
        exit;
      end if;
    end loop;

    if matched.id is null then
      scan_result := 'not_pass';

      -- Baris berukuran sama tetap dicari untuk menjelaskan penolakannya.
      -- Yang belum lunas didahulukan, dan di antaranya yang belum punya MPQ --
      -- itu sebab yang paling menentukan tindakan berikutnya, dan tindakannya
      -- bukan menembak ulang melainkan melengkapi MPQ Sheet.
      select schedule_row.* into explainer
      from public.delivery_schedule_rows schedule_row
      where schedule_row.session_id = p_session_id
        and regexp_replace(upper(schedule_row.product_size), '\s', '', 'g')
          = label_part_no_key
      order by
        (schedule_row.verified_qty < schedule_row.qty_delivery) desc,
        (schedule_row.mpq_qty is null) desc,
        schedule_row.row_no
      limit 1;

      if explainer.id is not null then
        out_mpq_missing := explainer.mpq_qty is null;
        out_size_complete := not out_mpq_missing
          and explainer.verified_qty >= explainer.qty_delivery;

        if not out_mpq_missing then
          out_full_box_qty := explainer.mpq_qty;
          out_last_box_qty := nullif(
            explainer.qty_delivery % explainer.mpq_qty, 0
          );
        end if;
      end if;
    else
      update public.delivery_schedule_rows
      set
        verified_qty = matched.verified_qty + label_qty,
        verified_at = case
          when matched.verified_qty + label_qty >= matched.qty_delivery
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

  -- Baris tanpa MPQ tidak menyumbang box ke hitungan, tetapi tetap terhitung
  -- sebagai baris yang belum lunas. Session karena itu tidak bisa tutup selama
  -- masih ada ukuran yang MPQ-nya belum ada.
  select
    count(*)::integer,
    count(*) filter (
      where schedule_row.verified_qty < schedule_row.qty_delivery
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
    coalesce(matched.mpq_qty, explainer.mpq_qty),
    coalesce(matched.expected_boxes, explainer.expected_boxes),
    coalesce(matched.verified_boxes, explainer.verified_boxes),
    (matched.id is not null and matched.verified_at is not null),
    out_size_complete,
    out_mpq_missing,
    out_full_box_qty,
    out_last_box_qty,
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
