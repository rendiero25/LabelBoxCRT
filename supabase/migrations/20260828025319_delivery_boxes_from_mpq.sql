-- Satu baris jadwal adalah satu kiriman, bukan satu box.
--
-- Sampai sekarang kolom Qty pada Schedule Delivery dibaca sebagai Qty per Box:
-- satu baris lunas oleh satu label. Yang sebenarnya tertulis di dokumen jadwal
-- adalah Qty Delivery -- seluruh jumlah yang dikirim untuk ukuran itu -- dan
-- berapa box yang menampungnya ditentukan MPQ ukuran tersebut.
--
-- 8000 pcs dengan MPQ 2000 berarti 4 box, jadi 4 kali scan. 7000 pcs dengan MPQ
-- 1500 berarti 5 box: empat box penuh 1500 dan satu box sisa 1000. Box sisa
-- itulah sebabnya jumlah box dibulatkan ke atas, bukan dibagi rata.
--
-- Qty di dalam QR ikut diperiksa, tidak sekadar dihitung banyaknya scan. Box
-- penuh harus ber-Qty tepat MPQ dan box sisa tepat sisanya; label ber-Qty lain
-- ditolak. Menghitung scan saja akan meloloskan empat box @1500 sebagai
-- kiriman 8000 pcs, dan selisih 2000 keping itu baru ketahuan di tempat
-- pelanggan.
--
-- Urutan scan tidak diatur. Box sisa boleh ditembak lebih dulu: yang dijaga
-- adalah komposisinya -- sekian box penuh dan paling banyak satu box sisa --
-- bukan giliran operator mengambil box dari palet.

-- Nama kolomnya ikut berubah. Membiarkannya bernama qty sementara artinya
-- berubah total adalah cara termurah membuat pembaca berikutnya salah.
alter table public.delivery_schedule_rows rename column qty to qty_delivery;

alter table public.delivery_schedule_rows
  -- MPQ disalin ke barisnya, bukan dibaca lewat join saat verifikasi. Dokumen
  -- MPQ direvisi lewat migrasi, dan jadwal yang truknya sedang diperiksa tidak
  -- boleh berubah jumlah box-nya di tengah jalan.
  add column mpq_qty integer,
  -- Yang dicatat jumlah keping, bukan jumlah box. Dari keping, jumlah box bisa
  -- dihitung pasti; dari jumlah box, komposisi penuh/sisa tidak bisa dipulihkan.
  add column verified_qty integer not null default 0;

-- Baris yang sudah ada dimasukkan dengan MPQ sama dengan Qty-nya sendiri,
-- sehingga jumlah box-nya tetap satu. Baris-baris itu diisi dan diperiksa di
-- bawah aturan lama -- satu label melunasi satu baris -- dan menghitungnya
-- ulang dengan aturan baru akan mengubah Session yang sudah DELIVERY OK menjadi
-- kurang, yaitu memalsukan pemeriksaan yang benar-benar terjadi.
update public.delivery_schedule_rows
set
  mpq_qty = qty_delivery,
  verified_qty = case when verified_at is null then 0 else qty_delivery end;

alter table public.delivery_schedule_rows
  alter column mpq_qty set not null,
  add constraint delivery_schedule_rows_mpq_positive check (mpq_qty > 0),
  add constraint delivery_schedule_rows_verified_qty_range
    check (verified_qty >= 0 and verified_qty <= qty_delivery);

-- Jumlah box diturunkan, tidak disimpan sebagai angka tersendiri: dua angka
-- untuk satu fakta akan berselisih cepat atau lambat, dan yang salah tidak
-- kelihatan dari luar.
alter table public.delivery_schedule_rows
  add column expected_boxes integer generated always as (
    qty_delivery / mpq_qty
    + case when qty_delivery % mpq_qty > 0 then 1 else 0 end
  ) stored,
  add column verified_boxes integer generated always as (
    verified_qty / mpq_qty
    + case when verified_qty % mpq_qty > 0 then 1 else 0 end
  ) stored;

/**
 * Menambah baris Schedule Delivery dari satu file.
 *
 * Qty pada file dibaca sebagai Qty Delivery, dan MPQ ukurannya dicari di MPQ
 * Sheet lalu disalin ke barisnya.
 *
 * Ukuran yang tidak ada di MPQ Sheet menggagalkan seluruh file dan namanya
 * disebutkan. Menerimanya dengan menganggap satu box akan membuat kiriman 8000
 * keping lunas oleh satu label; menerimanya lalu menolak scan-nya memindahkan
 * kegagalan ke lantai produksi, saat truk sudah datang. Yang kurang adalah data
 * master, dan itu pekerjaan admin sebelum jadwalnya diunggah.
 *
 * Part No yang sudah ada tetap tidak ditolak maupun ditimpa: dua kiriman ukuran
 * sama adalah dua baris jadwal, masing-masing dengan jumlah box sendiri.
 *
 * Nama kolom di `returns table` ikut berganti, dan itu terhitung perubahan tipe
 * balik yang tidak bisa direkonsiliasi create-or-replace. Jadi didrop dulu.
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
  missing_sizes text;
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

  -- Ukuran dicocokkan tanpa spasi, sama seperti saat scan: dokumen jadwal dan
  -- dokumen MPQ diketik terpisah dan tidak sepakat soal spasi sebelum "MM".
  select string_agg(distinct btrim(entry.value ->> 'productSize'), ', ')
  into missing_sizes
  from jsonb_array_elements(p_rows) as entry
  where not exists (
    select 1 from public.mpq_sheet_rows mpq
    where mpq.product_size_key
      = regexp_replace(upper(entry.value ->> 'productSize'), '\s', '', 'g')
  );

  if missing_sizes is not null then
    raise exception using
      errcode = 'P0001',
      message = 'DELIVERY_MPQ_NOT_FOUND',
      detail = missing_sizes;
  end if;

  select coalesce(max(existing.row_no), 0) + 1 into next_row_no
  from public.delivery_schedule_rows existing
  where existing.session_id = p_session_id;

  return query
  insert into public.delivery_schedule_rows (
    session_id, row_no, product_size, qty_delivery, mpq_qty, source_file_name
  )
  select
    p_session_id,
    next_row_no + (entry.ordinality::integer - 1),
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
 * Payload dipecah pada '|'. Field kedua ukuran produk, field ketiga Qty box
 * ini; sisanya tidak dibaca sama sekali.
 *
 * Sebuah scan diterima kalau ada baris jadwal berukuran sama yang masih kurang
 * box, dan Qty-nya cocok dengan salah satu dari dua nilai yang sah untuk baris
 * itu: MPQ, selama box penuh masih kurang, atau sisanya, selama box sisa belum
 * pernah masuk. Komposisi yang sudah masuk dibaca dari verified_qty saja --
 * sisa selalu lebih kecil dari MPQ, jadi verified_qty modulo MPQ menjawab pasti
 * apakah box sisa sudah terambil.
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
      -- "NOT PASS" tanpa menyebut Qty yang seharusnya membuat operator menembak
      -- ulang label yang sama alih-alih mengambil box yang benar.
      select schedule_row.* into explainer
      from public.delivery_schedule_rows schedule_row
      where schedule_row.session_id = p_session_id
        and regexp_replace(upper(schedule_row.product_size), '\s', '', 'g')
          = label_part_no_key
      order by
        (schedule_row.verified_qty < schedule_row.qty_delivery) desc,
        schedule_row.row_no
      limit 1;

      if explainer.id is not null then
        out_size_complete := explainer.verified_qty >= explainer.qty_delivery;
        out_full_box_qty := explainer.mpq_qty;
        out_last_box_qty := nullif(
          explainer.qty_delivery % explainer.mpq_qty, 0
        );
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

  -- Session ditutup hanya kalau ada barisnya. Jadwal kosong yang otomatis
  -- "selesai" akan menutup session sebelum satu pun kiriman diperiksa.
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
