-- Kode produk melebar setelah prd-999999, bukan dipotong jadi enam digit lagi.
--
-- Cacat yang sama persis dengan 20260821011700_box_code_widens_past_99.sql dan
-- 20260821015137_master_item_code_widens_past_99.sql, di pembangkit kode
-- Product: `lpad(teks, 6, '0')` di Postgres MEMOTONG ketika teksnya lebih
-- panjang dari lebar yang diminta, jadi begitu product_code_sequence lewat
-- 999999, nilai 1000000..1000009 semuanya menjadi 'prd-100000' dan
-- 1000010..1000019 menjadi 'prd-100001'.
--
-- Akibatnya sama seperti di Master Item: insert-nya sudah dibungkus loop retry,
-- jadi yang terjadi bukan error melainkan kode yang mundur dan berulang. Kode
-- produk baru akan tampak jauh lebih kecil daripada kode yang sudah ada, dan
-- setiap kali nomor yang dipotong itu masih dipakai baris yang hidup, loop
-- membakar sepuluh nilai sequence sebelum menemukan celah.
--
-- Berbeda dari nomor set di label_boxes -- yang dijaga rangkap tiga oleh
-- pemeriksaan set_count > 99, CHECK (set_no <= 99), dan UNIQUE (batch_id,
-- box_number) -- di sini tidak ada satu pun penjaga yang menahan sequence di
-- bawah lebar pad-nya. Jadi cacatnya hanya soal waktu, bukan soal mungkin.
--
-- product_code_sequence berada di 69 ketika migrasi ini ditulis, jadi cacatnya
-- masih sangat jauh dan belum pernah terpakai; tidak ada baris yang perlu
-- diperbaiki. Perbaikan ini murni menutup ranjau, dan untuk setiap nilai di
-- bawah 1000000 hasilnya identik byte-per-byte dengan versi lama
-- (lpad('69', 6, '0') dan lpad('69', greatest(6, 2), '0') sama-sama '000069').
--
-- Selain baris pembangkit kode, badan fungsi ini identik dengan versi di
-- 20260812100000_product_part_type.sql.

create or replace function public.create_product(
  p_part_name text,
  p_part_type text,
  p_outer_diameter numeric,
  p_inner_diameter numeric,
  p_length numeric
)
returns table(
  id uuid,
  product_code text,
  part_name text,
  part_type text,
  outer_diameter numeric,
  inner_diameter numeric,
  length numeric,
  normalized_dimensions text,
  is_active boolean,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  normalized_name text := btrim(p_part_name);
  normalized_type text := btrim(p_part_type);
  next_code_number text;
  generated_code text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'PRODUCT_ADMIN_REQUIRED';
  end if;

  if normalized_name = ''
    or char_length(normalized_name) > 200
    or normalized_type = ''
    or char_length(normalized_type) > 100
    or p_outer_diameter is null or p_outer_diameter <= 0
    or p_inner_diameter is null or p_inner_diameter <= 0
    or p_length is null or p_length <= 0 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INPUT_INVALID';
  end if;

  loop
    next_code_number := nextval('public.product_code_sequence')::text;

    -- greatest(6, length(...)) memberi lebar minimum enam digit tanpa pernah
    -- memotong: dua digit dipad jadi '000069', tujuh digit dibiarkan '1000000'.
    generated_code := 'prd-' || lpad(
      next_code_number, greatest(6, length(next_code_number)), '0'
    );

    begin
      insert into public.products (
        product_code, part_name, part_type, outer_diameter, inner_diameter, length
      ) values (
        generated_code, normalized_name, normalized_type,
        p_outer_diameter, p_inner_diameter, p_length
      ) returning * into id, product_code, part_name, outer_diameter, inner_diameter,
        length, normalized_dimensions, is_active, created_at, updated_at, part_type;
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'product.created', 'product', id::text,
    jsonb_build_object(
      'product_code', product_code,
      'part_type', part_type,
      'normalized_dimensions', normalized_dimensions
    )
  );

  return next;
end;
$function$;

notify pgrst, 'reload schema';
