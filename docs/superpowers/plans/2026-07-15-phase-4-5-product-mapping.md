# Phase 4.5 Product Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin dapat membuat, melihat, menonaktifkan, dan mengaktifkan relasi Product–Master Item tanpa duplikasi serta melihat pemakaian balik setiap Product.

**Architecture:** Halaman `/admin/product-mappings` memuat relation `master_item_products` bersama Master Item dan Product. Server Actions memanggil dua RPC ber-`SECURITY DEFINER`; RPC memverifikasi admin aktif, menjaga uniqueness, dan append audit log. Client directory mengikuti komponen admin Phase 4.3/4.4 dan melakukan filter/pencarian lokal.

**Tech Stack:** Next.js App Router, TypeScript strict, Supabase RPC/RLS, Vitest, shadcn/ui, Tailwind CSS.

## Global Constraints

- Hanya `admin` aktif dapat memutasi mapping.
- Product dan Master Item wajib aktif saat mapping baru dibuat.
- Satu pasangan `master_item_id` + `product_id` hanya satu row; inactive mapping diaktifkan kembali, bukan dibuat ulang.
- Mapping historis tidak dihapus; deactivate wajib memakai confirmation dialog dan audit log.
- Tidak ada `service_role` atau secret di client.

---

### Task 1: Validasi dan pesan domain

**Files:**

- Create: `src/features/product-mappings/validation.ts`
- Create: `src/features/product-mappings/validation.test.ts`
- Create: `src/features/product-mappings/form-state.ts`

**Interfaces:**

- Produces `parseProductMappingInput(formData)` yang mengembalikan `{ data: { masterItemId, productId } }` atau `{ error }`.
- Produces `productMappingRpcErrorMessage(message)` untuk error RPC aman.

- [ ] **Step 1: Write failing test**

```ts
expect(parseProductMappingInput(formData)).toEqual({
  data: { masterItemId: "item-id", productId: "product-id" },
})
expect(productMappingRpcErrorMessage("PRODUCT_MAPPING_EXISTS")).toBe(
  "Produk sudah dipetakan ke Master Item ini.",
)
```

- [ ] **Step 2: Run red test**

Run: `npm.cmd test -- src/features/product-mappings/validation.test.ts`

Expected: fail karena modul belum ada.

- [ ] **Step 3: Implement minimal validation**

```ts
export function parseProductMappingInput(formData: FormData) {
  const masterItemId = String(formData.get("masterItemId") ?? "").trim()
  const productId = String(formData.get("productId") ?? "").trim()
  if (!masterItemId || !productId)
    return { error: "Master Item dan produk wajib dipilih." }
  return { data: { masterItemId, productId } }
}
```

- [ ] **Step 4: Run green test**

Run: `npm.cmd test -- src/features/product-mappings/validation.test.ts`

Expected: all tests pass.

### Task 2: Database RPC, audit, dan generated types

**Files:**

- Create: `supabase/migrations/<timestamp>_product_mapping_admin_crud_audit.sql`
- Create: `supabase/tests/database/010_phase_4_5_product_mapping.test.sql`
- Modify: `src/types/database.ts`

**Interfaces:**

- Produces `public.create_master_item_product_mapping(p_master_item_id uuid, p_product_id uuid)`.
- Produces `public.set_master_item_product_active(p_mapping_id uuid, p_is_active boolean)`.

- [ ] **Step 1: Write failing database contract test**

```sql
select has_function(
  'public', 'create_master_item_product_mapping',
  array['uuid', 'uuid'],
  'mapping create RPC exists'
);
```

- [ ] **Step 2: Run red database test**

Run: `npx.cmd supabase test db --file supabase/tests/database/010_phase_4_5_product_mapping.test.sql`

Expected: fail karena RPC belum ada.

- [ ] **Step 3: Implement migration**

```sql
insert into public.master_item_products (master_item_id, product_id)
values (p_master_item_id, p_product_id)
on conflict (master_item_id, product_id)
do update set is_active = true;
```

RPC wajib validasi admin, kedua master aktif, append audit `product_mapping.created` atau `product_mapping.reactivated`, revoke `PUBLIC`/`anon`, lalu grant hanya ke `authenticated`.

- [ ] **Step 4: Update types and run database test**

Run: `npx.cmd supabase test db --file supabase/tests/database/010_phase_4_5_product_mapping.test.sql`

Expected: mapping dibuat, conflict tidak menggandakan row, deactivate menyisakan histori, audit ada.

### Task 3: Admin action dan directory mapping

**Files:**

- Create: `src/features/product-mappings/actions.ts`
- Create: `src/features/product-mappings/components/product-mapping-directory.tsx`
- Create: `src/app/admin/product-mappings/page.tsx`
- Modify: `src/app/admin/layout.tsx`

**Interfaces:**

- `createProductMappingAction` dan `setProductMappingActiveAction` memakai `requireAdmin`, RPC, dan `revalidatePath("/admin/product-mappings")`.
- Directory menerima mappings, Master Items, Products; menampilkan mapping aktif/nonaktif, form mapping baru, confirmation deactivate, serta reverse usage per Product.

- [ ] **Step 1: Implement server actions**

```ts
const { error } = await supabase.rpc("create_master_item_product_mapping", {
  p_master_item_id: parsed.data.masterItemId,
  p_product_id: parsed.data.productId,
})
```

- [ ] **Step 2: Implement page query and directory**

Page memilih mapping nested `master_items` dan `products`; query kedua memilih kandidat aktif. Directory menyediakan pencarian nama/kode/Part No, tabel mapping, grouping Product ke Master Item untuk reverse usage, dan AlertDialog sebelum deactivate.

- [ ] **Step 3: Add sidebar navigation**

Tambahkan link `Product Mapping` di administrasi, menuju `/admin/product-mappings`.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm.cmd test -- src/features/product-mappings/validation.test.ts` dan `npm.cmd run typecheck`

Expected: pass tanpa error TypeScript.

### Task 4: Documentation and final verification

**Files:**

- Create: `docs/development/product-mapping-management.md`
- Modify: `task.md`

- [ ] **Step 1: Document invariants and UI flow**

Dokumen menjelaskan pair uniqueness, reactivation, deactivate warning, reverse view, RPC error codes, audit actions, dan langkah validasi.

- [ ] **Step 2: Mark Task 4.5 complete only after evidence**

Run: `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run build`, database test, dan `git diff --check`.

Expected: seluruh command exit code 0, kecuali blocker environment dilaporkan eksplisit.
