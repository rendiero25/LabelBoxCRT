create sequence public.product_code_sequence
  as bigint
  minvalue 1
  start with 1;

select setval(
  'public.product_code_sequence',
  coalesce(
    (
      select max((regexp_match(product_code, '^prd-([0-9]+)$'))[1]::bigint)
      from public.products
    ),
    0
  ) + 1,
  false
);

revoke all on sequence public.product_code_sequence from public, anon, authenticated;

drop function public.create_product(text, text, numeric, numeric, numeric);

create function public.create_product(
  p_part_name text,
  p_outer_diameter numeric,
  p_inner_diameter numeric,
  p_length numeric
)
returns table (
  id uuid,
  product_code text,
  part_name text,
  outer_diameter numeric,
  inner_diameter numeric,
  length numeric,
  normalized_dimensions text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_name text := btrim(p_part_name);
  generated_code text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'PRODUCT_ADMIN_REQUIRED';
  end if;

  if normalized_name = ''
    or p_outer_diameter is null or p_outer_diameter <= 0
    or p_inner_diameter is null or p_inner_diameter <= 0
    or p_length is null or p_length <= 0 then
    raise exception using errcode = 'P0001', message = 'PRODUCT_INPUT_INVALID';
  end if;

  loop
    generated_code := 'prd-' || lpad(nextval('public.product_code_sequence')::text, 6, '0');

    begin
      insert into public.products (
        product_code, part_name, outer_diameter, inner_diameter, length
      ) values (
        generated_code, normalized_name, p_outer_diameter, p_inner_diameter, p_length
      ) returning * into id, product_code, part_name, outer_diameter, inner_diameter,
        length, normalized_dimensions, is_active, created_at, updated_at;
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
      'normalized_dimensions', normalized_dimensions
    )
  );

  return next;
end;
$$;

revoke execute on function public.create_product(text, numeric, numeric, numeric) from public, anon;
grant execute on function public.create_product(text, numeric, numeric, numeric) to authenticated;
