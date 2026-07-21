-- Expose hard delete for products that have no downstream references.
-- Referencing tables (master_item_products, box_layer_requirements,
-- packing_session_scans) use "on delete restrict", so a referenced product
-- raises foreign_key_violation which we map to a domain error.

create or replace function public.delete_product(
  p_product_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_code text;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'PRODUCT_ADMIN_REQUIRED';
  end if;

  select product_code into target_code
  from public.products
  where id = p_product_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'PRODUCT_NOT_FOUND';
  end if;

  begin
    delete from public.products where id = p_product_id;
  exception when foreign_key_violation then
    raise exception using errcode = 'P0001', message = 'PRODUCT_IN_USE';
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'product.deleted', 'product', p_product_id::text,
    jsonb_build_object('product_code', target_code)
  );
end;
$$;

revoke execute on function public.delete_product(uuid) from public, anon;
grant execute on function public.delete_product(uuid) to authenticated;
