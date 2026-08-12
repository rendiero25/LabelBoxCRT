-- Produk mendapat jenis partnya sendiri: "Tube" atau "Tube Assy".
--
-- Sampai sekarang part_name menyimpan awalan produk ("VO-B", "CVO-B",
-- "VO-Tr"), bukan jenis partnya, dan jenis itu memang tidak punya tempat di
-- tabel ini. Kolom baru menampungnya; part_name tetap berarti awalan.
--
-- Kolomnya dibiarkan boleh null dan baris yang sudah ada tidak diisi apa pun.
-- Menebak "Tube" untuk 28 produk lama berarti mengarang data; yang benar
-- diketahui orang yang mengurus produknya, dan form Edit sekarang mewajibkan
-- field ini sehingga nilainya terisi begitu produknya disunting.

alter table public.products add column if not exists part_type text;

comment on column public.products.part_type is
  'Jenis part produk, misalnya Tube atau Tube Assy. Berbeda dari part_name yang menyimpan awalan nama (VO-B, CVO-B).';

drop function if exists public.create_product(text, numeric, numeric, numeric);

create function public.create_product(
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
    generated_code := 'prd-' || lpad(nextval('public.product_code_sequence')::text, 6, '0');

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

revoke execute on function public.create_product(text, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.create_product(text, text, numeric, numeric, numeric) to authenticated;
grant execute on function public.create_product(text, text, numeric, numeric, numeric) to service_role;

drop function if exists public.update_product(uuid, text, text, numeric, numeric, numeric);

create function public.update_product(
  p_product_id uuid,
  p_product_code text,
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
  normalized_code text := lower(btrim(p_product_code));
  normalized_name text := btrim(p_part_name);
  normalized_type text := btrim(p_part_type);
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'PRODUCT_ADMIN_REQUIRED';
  end if;

  if normalized_code !~ '^[a-z0-9][a-z0-9_-]{1,63}$'
    or normalized_name = ''
    or char_length(normalized_name) > 200
    or normalized_type = ''
    or char_length(normalized_type) > 100
    or p_outer_diameter is null or p_outer_diameter <= 0 or p_outer_diameter > 1000000
    or p_inner_diameter is null or p_inner_diameter <= 0 or p_inner_diameter > 1000000
    or p_length is null or p_length <= 0 or p_length > 1000000 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INPUT_INVALID';
  end if;

  if exists (
    select 1 from public.packing_session_scans
    where product_id = p_product_id and result = 'accepted'
  ) then
    raise exception using errcode = 'P0001', message = 'PRODUCT_IN_USE';
  end if;

  begin
    update public.products
    set product_code = normalized_code,
        part_name = normalized_name,
        part_type = normalized_type,
        outer_diameter = p_outer_diameter,
        inner_diameter = p_inner_diameter,
        length = p_length
    where public.products.id = p_product_id
    returning * into id, product_code, part_name, outer_diameter, inner_diameter,
      length, normalized_dimensions, is_active, created_at, updated_at, part_type;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'PRODUCT_CODE_EXISTS';
  end;

  if not found then
    raise exception using errcode = 'P0001', message = 'PRODUCT_NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'product.updated', 'product', id::text,
    jsonb_build_object(
      'product_code', product_code,
      'part_type', part_type,
      'normalized_dimensions', normalized_dimensions
    )
  );

  return next;
end;
$function$;

revoke execute on function public.update_product(uuid, text, text, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.update_product(uuid, text, text, text, numeric, numeric, numeric) to authenticated;
grant execute on function public.update_product(uuid, text, text, text, numeric, numeric, numeric) to service_role;

notify pgrst, 'reload schema';
