-- MPQ Sheet bisa disunting admin.
--
-- Tabel ini dibuat sebagai rujukan yang hanya dibaca: revisi dokumen masuk
-- sebagai migrasi baru. Yang membatalkan rancangan itu adalah dokumennya
-- sendiri. Daftar MPQ bertanggal 2021, sementara DO Report 21 Agustus 2026
-- memuat delapan ukuran sheet yang belum ada di dalamnya -- empat di antaranya
-- VS-B yang dikirim rutin. Selama satu ukuran belum punya MPQ, jadwal yang
-- memuatnya tidak bisa DELIVERY OK, dan menunggu migrasi berarti menahan
-- pemeriksaan kiriman sampai ada yang sempat menulis SQL.
--
-- Tulisnya tetap lewat RPC security definer dan tetap khusus admin: yang
-- berubah siapa yang boleh menambah, bukan lewat mana. `authenticated` masih
-- hanya punya SELECT, dan 033 gagal kalau itu berubah.

alter table public.mpq_sheet_rows
  add column is_active boolean not null default true;

/**
 * Menambah satu ukuran ke MPQ Sheet.
 *
 * Nomor urutnya melanjutkan yang terakhir. Baris yang dihapus meninggalkan
 * lubang dan itu dibiarkan: nomor ini cuma jangkar urutan tampilan, dan
 * menomori ulang seluruh tabel setiap kali satu baris dibuang akan memindahkan
 * baris-baris yang tidak disentuh siapa pun.
 */
create function public.create_mpq_sheet_row(
  p_product_size text,
  p_mpq_qty integer,
  p_unit text
)
returns table (
  id uuid,
  row_no integer,
  product_size text,
  mpq_qty integer,
  unit text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_size text := upper(
    regexp_replace(btrim(coalesce(p_product_size, '')), '\s+', ' ', 'g')
  );
  normalized_unit text := upper(btrim(coalesce(p_unit, '')));
  next_row_no integer;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MPQ_ADMIN_REQUIRED';
  end if;

  if normalized_size = ''
    or char_length(normalized_size) > 100
    or normalized_unit = ''
    or char_length(normalized_unit) > 32
    or p_mpq_qty is null
    or p_mpq_qty <= 0
    or p_mpq_qty > 10000000 then
    raise exception using errcode = 'P0001', message = 'MPQ_INPUT_INVALID';
  end if;

  select coalesce(max(existing.row_no), 0) + 1 into next_row_no
  from public.mpq_sheet_rows existing;

  begin
    insert into public.mpq_sheet_rows (row_no, product_size, mpq_qty, unit)
    values (next_row_no, normalized_size, p_mpq_qty, normalized_unit)
    returning
      mpq_sheet_rows.id, mpq_sheet_rows.row_no, mpq_sheet_rows.product_size,
      mpq_sheet_rows.mpq_qty, mpq_sheet_rows.unit, mpq_sheet_rows.is_active,
      mpq_sheet_rows.created_at, mpq_sheet_rows.updated_at
    into id, row_no, product_size, mpq_qty, unit, is_active, created_at, updated_at;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'MPQ_SIZE_EXISTS';
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'mpq_sheet_row.created', 'mpq_sheet_row', id::text,
    jsonb_build_object('product_size', product_size, 'mpq_qty', mpq_qty, 'unit', unit)
  );

  return next;
end;
$$;

/**
 * Mengubah satu ukuran. Nomor urutnya tidak ikut berubah -- itu tempat baris
 * ini di daftar, bukan bagian dari datanya.
 *
 * MPQ yang diubah tidak menyentuh jadwal yang sudah berjalan: jadwal menyalin
 * MPQ ke barisnya sendiri saat diunggah, supaya truk yang sedang diperiksa
 * tidak berubah jumlah box-nya di tengah jalan.
 */
create function public.update_mpq_sheet_row(
  p_row_id uuid,
  p_product_size text,
  p_mpq_qty integer,
  p_unit text
)
returns table (
  id uuid,
  row_no integer,
  product_size text,
  mpq_qty integer,
  unit text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_size text := upper(
    regexp_replace(btrim(coalesce(p_product_size, '')), '\s+', ' ', 'g')
  );
  normalized_unit text := upper(btrim(coalesce(p_unit, '')));
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MPQ_ADMIN_REQUIRED';
  end if;

  if normalized_size = ''
    or char_length(normalized_size) > 100
    or normalized_unit = ''
    or char_length(normalized_unit) > 32
    or p_mpq_qty is null
    or p_mpq_qty <= 0
    or p_mpq_qty > 10000000 then
    raise exception using errcode = 'P0001', message = 'MPQ_INPUT_INVALID';
  end if;

  begin
    update public.mpq_sheet_rows
    set product_size = normalized_size, mpq_qty = p_mpq_qty, unit = normalized_unit
    where public.mpq_sheet_rows.id = p_row_id
    returning
      mpq_sheet_rows.id, mpq_sheet_rows.row_no, mpq_sheet_rows.product_size,
      mpq_sheet_rows.mpq_qty, mpq_sheet_rows.unit, mpq_sheet_rows.is_active,
      mpq_sheet_rows.created_at, mpq_sheet_rows.updated_at
    into id, row_no, product_size, mpq_qty, unit, is_active, created_at, updated_at;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'MPQ_SIZE_EXISTS';
  end;

  if not found then
    raise exception using errcode = 'P0001', message = 'MPQ_NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'mpq_sheet_row.updated', 'mpq_sheet_row', id::text,
    jsonb_build_object('product_size', product_size, 'mpq_qty', mpq_qty, 'unit', unit)
  );

  return next;
end;
$$;

/**
 * Menonaktifkan satu ukuran. Barisnya tetap terlihat di daftar tetapi tidak
 * lagi dipakai jadwal baru: `add_delivery_schedule_rows` hanya membaca yang
 * aktif, sehingga ukuran nonaktif diperlakukan seperti belum punya MPQ.
 *
 * Tanpa itu menonaktifkan cuma mengubah warna badge, dan admin yang menonaktifkan
 * satu MPQ karena salah akan mendapati jadwal berikutnya tetap memakainya.
 */
create function public.set_mpq_sheet_row_active(
  p_row_id uuid,
  p_is_active boolean
)
returns table (
  id uuid,
  row_no integer,
  product_size text,
  mpq_qty integer,
  unit text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MPQ_ADMIN_REQUIRED';
  end if;

  update public.mpq_sheet_rows
  set is_active = p_is_active
  where public.mpq_sheet_rows.id = p_row_id
  returning
    mpq_sheet_rows.id, mpq_sheet_rows.row_no, mpq_sheet_rows.product_size,
    mpq_sheet_rows.mpq_qty, mpq_sheet_rows.unit, mpq_sheet_rows.is_active,
    mpq_sheet_rows.created_at, mpq_sheet_rows.updated_at
  into id, row_no, product_size, mpq_qty, unit, is_active, created_at, updated_at;

  if not found then
    raise exception using errcode = 'P0001', message = 'MPQ_NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(),
    case when is_active then 'mpq_sheet_row.activated' else 'mpq_sheet_row.deactivated' end,
    'mpq_sheet_row', id::text,
    jsonb_build_object('product_size', product_size)
  );

  return next;
end;
$$;

/**
 * Membuang satu ukuran. Tidak ada yang menunjuk baris ini lewat foreign key --
 * jadwal menyalin angkanya, bukan menyimpan referensinya -- jadi menghapusnya
 * tidak memutus jadwal yang sudah berjalan. Yang hilang cuma rujukannya untuk
 * jadwal berikutnya, dan ringkasannya ditulis ke audit_logs lebih dulu.
 */
create function public.delete_mpq_sheet_row(p_row_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target public.mpq_sheet_rows%rowtype;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MPQ_ADMIN_REQUIRED';
  end if;

  select * into target
  from public.mpq_sheet_rows sheet_row
  where sheet_row.id = p_row_id;

  if target.id is null then
    raise exception using errcode = 'P0001', message = 'MPQ_NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'mpq_sheet_row.deleted', 'mpq_sheet_row', target.id::text,
    jsonb_build_object(
      'product_size', target.product_size,
      'mpq_qty', target.mpq_qty,
      'unit', target.unit
    )
  );

  delete from public.mpq_sheet_rows
  where public.mpq_sheet_rows.id = p_row_id;
end;
$$;

-- Jadwal baru hanya memakai MPQ yang aktif. Satu-satunya perubahan pada fungsi
-- ini dibanding 20260828035015 adalah syarat `mpq.is_active` pada dua
-- pencariannya.
create or replace function public.add_delivery_schedule_rows(
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
        and mpq.is_active
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

revoke execute on function public.create_mpq_sheet_row(text, integer, text)
  from public, anon;
revoke execute on function public.update_mpq_sheet_row(uuid, text, integer, text)
  from public, anon;
revoke execute on function public.set_mpq_sheet_row_active(uuid, boolean)
  from public, anon;
revoke execute on function public.delete_mpq_sheet_row(uuid) from public, anon;

grant execute on function public.create_mpq_sheet_row(text, integer, text)
  to authenticated;
grant execute on function public.update_mpq_sheet_row(uuid, text, integer, text)
  to authenticated;
grant execute on function public.set_mpq_sheet_row_active(uuid, boolean)
  to authenticated;
grant execute on function public.delete_mpq_sheet_row(uuid) to authenticated;

notify pgrst, 'reload schema';
