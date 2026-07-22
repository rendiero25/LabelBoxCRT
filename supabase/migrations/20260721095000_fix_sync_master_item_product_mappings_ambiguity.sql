-- `product_id` was both a PL/pgSQL variable and a table column in
-- sync_master_item_product_mappings (the same class of bug already fixed
-- once for validate_box_definition_payload in
-- 20260720031505_fix_box_definition_payload_product_id_ambiguity.sql).
-- PostgreSQL rejects the unqualified reference at runtime, breaking every
-- create_master_item_box / save_master_item_box_requirements call.

create or replace function private.sync_master_item_product_mappings(
  p_master_item_id uuid,
  p_layers jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  layer_record record;
  requirement_record record;
  product_text text;
  parsed_product_id uuid;
begin
  for layer_record in
    select layer.value
    from jsonb_array_elements(p_layers) as layer(value)
  loop
    for requirement_record in
      select requirement.value
      from jsonb_array_elements(layer_record.value -> 'requirements') as requirement(value)
    loop
      product_text := requirement_record.value ->> 'product_id';
      begin
        parsed_product_id := product_text::uuid;
      exception when invalid_text_representation then
        continue;
      end;

      if exists (
        select 1 from public.products product
        where product.id = parsed_product_id and product.is_active
      ) then
        insert into public.master_item_products (master_item_id, product_id, is_active)
        values (p_master_item_id, parsed_product_id, true)
        on conflict (master_item_id, product_id) do update
        set is_active = true
        where not public.master_item_products.is_active;
      end if;
    end loop;
  end loop;
end;
$$;

revoke execute on function private.sync_master_item_product_mappings(uuid, jsonb)
  from public, anon, authenticated;
