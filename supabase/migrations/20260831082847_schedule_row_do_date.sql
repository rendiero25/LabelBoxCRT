-- DO Date ikut tersimpan dari dokumen.
--
-- Kartu session menyebut tanggal DO dan customer di sebelah namanya, supaya
-- operator tahu kiriman mana yang sedang dibuka tanpa menggulir tabelnya.
-- Customer sudah tersimpan sejak 20260828035015; tanggalnya belum pernah
-- dibaca sama sekali.
--
-- Boleh kosong. Dokumen jadwal lama tidak punya kolom DO Date, dan baris yang
-- sudah ada tidak bisa diisi belakangan -- tanggalnya cuma ada di file yang
-- sudah lewat. Menolak baris tanpa tanggal berarti menolak seluruh jadwal lama.

alter table public.delivery_schedule_rows add column do_date date;

/**
 * Menambah baris Schedule Delivery dari satu file.
 *
 * Sama seperti sebelumnya, ditambah DO Date. Tanggal yang tidak berbentuk
 * YYYY-MM-DD disimpan null alih-alih menggagalkan file: ia cuma keterangan di
 * kartu, dan satu dokumen berformat tanggal aneh tidak boleh menahan seluruh
 * pemeriksaan kiriman.
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
  do_date date,
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
    session_id, row_no, customer, do_date, product_size, qty_delivery,
    source_file_name
  )
  select
    p_session_id,
    next_row_no + (entry.ordinality::integer - 1),
    nullif(btrim(coalesce(entry.value ->> 'customer', '')), ''),
    case
      when (entry.value ->> 'doDate') ~ '^\d{4}-\d{2}-\d{2}$'
      then (entry.value ->> 'doDate')::date
    end,
    upper(regexp_replace(btrim(entry.value ->> 'productSize'), '\s+', ' ', 'g')),
    (entry.value ->> 'qty')::integer,
    normalized_file
  from jsonb_array_elements(p_rows) with ordinality as entry(value, ordinality)
  returning
    public.delivery_schedule_rows.id,
    public.delivery_schedule_rows.row_no,
    public.delivery_schedule_rows.customer,
    public.delivery_schedule_rows.do_date,
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

notify pgrst, 'reload schema';
