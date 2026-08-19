-- Nomor urut Master Item diberikan tabelnya sendiri, bukan satu fungsi saja.
--
-- Nomornya diberikan di create_master_item, dan itu memaksa setiap jalur lain
-- yang menulis ke master_items -- perbaikan lewat SQL, seed, berkas tes --
-- mengingat aturan yang sama atau gagal pada kolom not null. Aturannya karena
-- itu pindah ke trigger: siapa pun yang menyisipkan baris tanpa nomor akan
-- mendapat lanjutan nomor terakhir.
--
-- Kuncinya menahan dua penyisipan bersamaan supaya keduanya tidak menghitung
-- nomor yang sama. Nomor yang ditinggalkan Master Item terhapus dibiarkan
-- kosong: menomori ulang berarti QR yang sudah tertempel di box menunjuk
-- nomor milik part lain.

create or replace function private.assign_master_item_row_no()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.row_no is null then
    perform pg_advisory_xact_lock(hashtext('public.master_items.row_no'));

    select coalesce(max(item.row_no), 0) + 1 into new.row_no
    from public.master_items item;
  end if;

  return new;
end;
$$;

drop trigger if exists master_items_assign_row_no on public.master_items;

create trigger master_items_assign_row_no
before insert on public.master_items
for each row execute function private.assign_master_item_row_no();

create or replace function public.create_master_item(
  p_part_no text,
  p_part_name text,
  p_unit text,
  p_default_label_qty integer,
  p_item_code text default null,
  p_supplier_id uuid default null
)
returns table (
  id uuid,
  item_code text,
  part_no text,
  part_name text,
  unit text,
  default_label_qty integer,
  supplier_id uuid,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_item_code text := nullif(lower(btrim(coalesce(p_item_code, ''))), '');
  normalized_part_no text := regexp_replace(upper(btrim(p_part_no)), '\s+', ' ', 'g');
  normalized_part_name text := btrim(p_part_name);
  normalized_unit text := initcap(lower(btrim(p_unit)));
  candidate_code text;
  violated_constraint text;
  assigned_row_no integer;
begin
  if not private.is_active_admin() then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_ADMIN_REQUIRED';
  end if;

  if (normalized_item_code is not null and normalized_item_code !~ '^[a-z0-9][a-z0-9_-]{1,63}$')
    or normalized_part_no !~ '^[A-Z0-9][A-Z0-9 _./-]{1,127}$'
    or normalized_part_name = ''
    or char_length(normalized_part_name) > 200
    or normalized_unit !~ '^[A-Za-z][A-Za-z ./-]{0,31}$'
    or p_default_label_qty is null or p_default_label_qty < 1 or p_default_label_qty > 1000000 then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_INPUT_INVALID';
  end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers supplier
    where supplier.id = p_supplier_id and supplier.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'MASTER_ITEM_SUPPLIER_NOT_FOUND';
  end if;

  if normalized_item_code is null then
    loop
      candidate_code := 'mstritem-' || lpad(nextval('public.master_item_code_seq')::text, 2, '0');

      begin
        insert into public.master_items (item_code, part_no, part_name, unit, default_label_qty, supplier_id)
        values (candidate_code, normalized_part_no, normalized_part_name, normalized_unit, p_default_label_qty, p_supplier_id)
        returning
          public.master_items.id, public.master_items.item_code, public.master_items.part_no,
          public.master_items.part_name, public.master_items.unit, public.master_items.default_label_qty,
          public.master_items.supplier_id, public.master_items.is_active, public.master_items.created_at,
          public.master_items.updated_at, public.master_items.row_no
        into
          id, item_code, part_no, part_name, unit, default_label_qty, supplier_id,
          is_active, created_at, updated_at, assigned_row_no;
        exit;
      exception when unique_violation then
        get stacked diagnostics violated_constraint = constraint_name;
        if violated_constraint <> 'master_items_item_code_key' then
          raise exception using errcode = 'P0001', message = 'MASTER_ITEM_PART_NO_EXISTS';
        end if;
      end;
    end loop;
  else
    begin
      insert into public.master_items (item_code, part_no, part_name, unit, default_label_qty, supplier_id)
      values (normalized_item_code, normalized_part_no, normalized_part_name, normalized_unit, p_default_label_qty, p_supplier_id)
      returning
        public.master_items.id, public.master_items.item_code, public.master_items.part_no,
        public.master_items.part_name, public.master_items.unit, public.master_items.default_label_qty,
        public.master_items.supplier_id, public.master_items.is_active, public.master_items.created_at,
        public.master_items.updated_at, public.master_items.row_no
      into
        id, item_code, part_no, part_name, unit, default_label_qty, supplier_id,
        is_active, created_at, updated_at, assigned_row_no;
    exception when unique_violation then
      get stacked diagnostics violated_constraint = constraint_name;
      raise exception using errcode = 'P0001', message = case
        when violated_constraint = 'master_items_item_code_key' then 'MASTER_ITEM_CODE_EXISTS'
        else 'MASTER_ITEM_PART_NO_EXISTS'
      end;
    end;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    auth.uid(), 'master_item.created', 'master_item', id::text,
    jsonb_build_object(
      'item_code', item_code,
      'row_no', assigned_row_no,
      'part_no', part_no,
      'default_label_qty', default_label_qty,
      'supplier_id', supplier_id
    )
  );

  return next;
end;
$$;

notify pgrst, 'reload schema';
