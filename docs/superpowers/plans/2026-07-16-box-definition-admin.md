# Box Definition Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Admin membuat, memvalidasi, mengaktifkan, dan meng-version definisi box dari aplikasi.

**Architecture:** Secure Supabase RPC menangani mutation dan audit. Next.js server action memvalidasi FormData lalu memanggil RPC. Admin route menyediakan data; client directory menyediakan editor layer, requirement, ringkasan, publish, dan clone version.

**Tech Stack:** Next.js App Router, TypeScript strict, Supabase PostgreSQL/RPC/RLS, Vitest, pgTAP, shadcn/ui.

## Global Constraints

- Package manager npm; gunakan npx.cmd pada PowerShell.
- Semua action memanggil requireAdmin(); setiap RPC memeriksa private.is_active_admin().
- Used berarti box_definition punya minimal satu packing_sessions row. Versi used tidak boleh destructively update.
- Requirement hanya memakai product aktif dengan master_item_products mapping aktif untuk Master Item box.
- expected_qty integer 1..1000000. Nomor dan urutan layer/requirement positif serta kontigu.
- Existing private.validate_box_definition dan private.activate_box_definition tetap sumber validasi/aktivasi database.
- Function public memakai security definer dan set search_path = pg_catalog; revoke PUBLIC dan anon; grant authenticated saja.
- UI pakai shadcn existing: Field, FieldGroup, Card, Table, Dialog, AlertDialog, Alert, Badge, Select, Button, Spinner, Empty, Sonner.
- Jangan stage perubahan tidak terkait.

## File Structure

- Create: supabase/migrations/<timestamp>_box_definition_admin_crud.sql
- Create: supabase/tests/database/011_phase_4_6_box_definition.test.sql
- Create: src/features/box-definitions/validation.ts
- Create: src/features/box-definitions/validation.test.ts
- Create: src/features/box-definitions/form-state.ts
- Create: src/features/box-definitions/actions.ts
- Create: src/features/box-definitions/components/box-definition-directory.tsx
- Create: src/app/admin/box-definitions/page.tsx
- Create: docs/development/box-definition-management.md
- Modify: src/app/admin/layout.tsx
- Modify: src/types/database.ts
- Modify: task.md

### Task 1: Test-first nested input validation

**Files:**

- Create: src/features/box-definitions/validation.ts
- Test: src/features/box-definitions/validation.test.ts

**Interfaces:**

- BoxDefinitionInput = { masterItemId: string; boxCode: string; boxName: string; layers: BoxLayerInput[] }.
- BoxLayerInput = { name: string; requirements: { productId: string; expectedQty: number }[] }.
- parseBoxDefinitionInput(formData) returns { data: BoxDefinitionInput } or { error: string }.
- boxDefinitionRpcErrorMessage(message) returns safe Indonesian message.

- [ ] **Step 1: Write failing tests**

  import { describe, expect, it } from "vitest"
  import { parseBoxDefinitionInput } from "@/features/box-definitions/validation"

  it("normalizes box and layer data", () => {
  const formData = new FormData()
  formData.set("masterItemId", "item-1")
  formData.set("boxCode", " b101 ")
  formData.set("boxName", " B101 Sample ")
  formData.set("layers", JSON.stringify([{ name: " Layer 1 ", requirements: [{ productId: "product-1", expectedQty: "3" }] }]))
  expect(parseBoxDefinitionInput(formData)).toEqual({
  data: { masterItemId: "item-1", boxCode: "B101", boxName: "B101 Sample", layers: [{ name: "Layer 1", requirements: [{ productId: "product-1", expectedQty: 3 }] }] },
  })
  })

  it("rejects zero expected quantity", () => {
  const formData = new FormData()
  formData.set("masterItemId", "item-1")
  formData.set("boxCode", "B101")
  formData.set("boxName", "B101")
  formData.set("layers", JSON.stringify([{ name: "Layer 1", requirements: [{ productId: "product-1", expectedQty: "0" }] }]))
  expect(parseBoxDefinitionInput(formData)).toEqual({
  error: "Qty requirement harus berupa bilangan bulat lebih besar dari 0.",
  })
  })

- [ ] **Step 2: Verify red**

Run: npm test -- src/features/box-definitions/validation.test.ts

Expected: FAIL, module belum ada.

- [ ] **Step 3: Implement minimal validation**

  export function parseBoxDefinitionInput(formData: FormData) {
  const masterItemId = String(formData.get("masterItemId") ?? "").trim()
  const boxCode = String(formData.get("boxCode") ?? "").trim().toUpperCase()
  const boxName = String(formData.get("boxName") ?? "").trim()
  let rawLayers: unknown
  try { rawLayers = JSON.parse(String(formData.get("layers") ?? "[]")) } catch { return { error: "Layer box tidak valid." } }
  if (!masterItemId || !boxCode || !boxName) return { error: "Master Item, kode box, dan nama box wajib diisi." }
  if (boxCode.length > 64 || boxName.length > 200 || !Array.isArray(rawLayers) || rawLayers.length === 0) return { error: "Data box tidak valid." }
  const layers = rawLayers.map((layer) => ({ name: String((layer as { name?: unknown }).name ?? "").trim(), requirements: Array.isArray((layer as { requirements?: unknown }).requirements) ? (layer as { requirements: unknown[] }).requirements.map((requirement) => ({ productId: String((requirement as { productId?: unknown }).productId ?? "").trim(), expectedQty: Number((requirement as { expectedQty?: unknown }).expectedQty) })) : [] }))
  if (layers.some((layer) => !layer.name || !layer.requirements.length)) return { error: "Setiap layer wajib memiliki nama dan minimal satu requirement produk." }
  if (layers.some((layer) => layer.requirements.some((item) => !item.productId))) return { error: "Produk requirement wajib dipilih." }
  if (layers.some((layer) => layer.requirements.some((item) => !Number.isInteger(item.expectedQty) || item.expectedQty < 1 || item.expectedQty > 1000000))) return { error: "Qty requirement harus berupa bilangan bulat lebih besar dari 0." }
  return { data: { masterItemId, boxCode, boxName, layers } }
  }

Map codes BOX_DEFINITION_ADMIN_REQUIRED, BOX_DEFINITION_INPUT_INVALID, BOX_DEFINITION_IN_USE, BOX_DEFINITION_NOT_FOUND, BOX_DEFINITION_VERSION_EXISTS, BOX_DEFINITION_INVALID, and BOX_DEFINITION_PRODUCT_NOT_ALLOWED.

- [ ] **Step 4: Verify green**

Run: npm test -- src/features/box-definitions/validation.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

  git add src/features/box-definitions/validation.ts src/features/box-definitions/validation.test.ts
  git commit -m "test: cover box definition input validation"

### Task 2: Secure database RPC and pgTAP

**Files:**

- Create: generated migration file
- Create: supabase/tests/database/011_phase_4_6_box_definition.test.sql
- Modify: src/types/database.ts

**Interfaces:**

- public.create_box_definition(p_master_item_id uuid, p_box_code text, p_box_name text, p_layers jsonb) returns uuid.
- public.update_box_definition(p_box_definition_id uuid, p_box_code text, p_box_name text, p_layers jsonb) returns uuid.
- public.publish_box_definition(p_box_definition_id uuid) returns uuid.
- public.clone_box_definition_version(p_box_definition_id uuid) returns uuid.

- [ ] **Step 1: Create migration**

Run: npx.cmd supabase migration new box_definition_admin_crud

Expected: one timestamped SQL file.

- [ ] **Step 2: Write failing pgTAP test**

  select has_function('public', 'create_box_definition', array['uuid','text','text','jsonb'], 'create RPC exists');
  select throws_ok(

  $$ select public.create_box_definition(
        '92000000-0000-0000-0000-000000000001', 'B101', 'B101',
        '[{"name":"Layer 1","requirements":[{"product_id":"93000000-0000-0000-0000-000000000001","expected_qty":0}]}]'::jsonb
      ) $$,
  'P0001', 'BOX_DEFINITION_INPUT_INVALID', 'reject zero quantity'
  );
  $$

Seed admin, active Master Item, active product, and active mapping. Assert create persists ordered layer/requirement and audit; publish activates; update after packing session raises BOX_DEFINITION_IN_USE; clone creates next inactive version with same content; anon cannot execute.

- [ ] **Step 3: Verify red**

Run project database test command for 011_phase_4_6_box_definition.test.sql.

Expected: FAIL, functions missing.

- [ ] **Step 4: Implement minimum RPC boundary**

Each function is security definer set search_path = pg_catalog and starts:

    if not private.is_active_admin() then
      raise exception using errcode = 'P0001', message = 'BOX_DEFINITION_ADMIN_REQUIRED';
    end if;

Normalize btrim/upper box code; validate Master Item, JSON array structure, layer name, product ID, duplicate product per layer, expected_qty, active product, and active mapping. Insert layer_no/sort_order by ordinality. Update first checks packing_sessions, deletes old draft-only child rows, then writes ordered replacements. Clone locks source and sibling definitions, inserts max(version)+1 inactive, copies layers then requirements by sort_order. Publish calls private.activate_box_definition(p_box_definition_id, gen_random_uuid()). Each mutating function inserts audit_logs row.

At end revoke all four signatures from public and anon; grant each to authenticated. Regenerate src/types/database.ts using project Supabase type-generation command.

- [ ] **Step 5: Verify green**

Run single pgTAP test; all database tests; Supabase advisors; `supabase migration list --linked`.

Expected: all assertions pass, no new security error, migration listed.

- [ ] **Step 6: Commit**

  git add supabase/migrations/*_box_definition_admin_crud.sql supabase/tests/database/011_phase_4_6_box_definition.test.sql src/types/database.ts
  git commit -m "feat: add secure box definition admin RPCs"

### Task 3: Server actions, page, navigation

**Files:**

- Create: src/features/box-definitions/form-state.ts
- Create: src/features/box-definitions/actions.ts
- Create: src/app/admin/box-definitions/page.tsx
- Modify: src/app/admin/layout.tsx

**Interfaces:**

- BoxDefinitionActionState = { error?: string; success?: string }.
- Actions call Task 2 RPCs and revalidate /admin/box-definitions.
- Page returns nested definitions, active Master Items, active mappings/products, and used definition IDs.

- [ ] **Step 1: Write failing action tests**

Test malformed layers returns parser error before RPC, BOX_DEFINITION_IN_USE maps safe error, and success calls revalidatePath("/admin/box-definitions").

- [ ] **Step 2: Verify red**

Run: npm test -- src/features/box-definitions/validation.test.ts

Expected: FAIL until actions exist.

- [ ] **Step 3: Implement route and actions**

Each action calls requireAdmin(), parses FormData, calls matching RPC, maps error.message, and revalidates page. Page runs these queries in Promise.all:

    box_definitions.select("id, master_item_id, box_code, box_name, version, is_active, master_items(id, part_no, part_name), box_layers(id, layer_no, layer_name, sort_order, box_layer_requirements(id, product_id, expected_qty, sort_order, products(id, product_code, part_name, normalized_dimensions)))")
    master_items.select("id, part_no, part_name").eq("is_active", true)
    master_item_products.select("master_item_id, product_id, products(id, product_code, part_name, normalized_dimensions)").eq("is_active", true)
    packing_sessions.select("box_definition_id")

Add BoxIcon sidebar link to /admin/box-definitions; preserve existing links.

- [ ] **Step 4: Verify green**

Run: npm test -- src/features/box-definitions/validation.test.ts
Run: npm run typecheck

Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

  git add src/features/box-definitions/form-state.ts src/features/box-definitions/actions.ts src/app/admin/box-definitions/page.tsx src/app/admin/layout.tsx
  git commit -m "feat: add box definition admin actions"

### Task 4: Client editor, summary, clone flow

**Files:**

- Create: src/features/box-definitions/components/box-definition-directory.tsx
- Create: docs/development/box-definition-management.md

**Interfaces:**

- Directory consumes nested page data and used boolean.
- Directory sends hidden layers JSON with { name, requirements: [{ product_id, expected_qty }] }.

- [ ] **Step 1: Write failing component tests**

Cover initial layer, add/move-up/move-down contiguous order, add requirement, grand total, used lock, publish confirmation, and clone action.

- [ ] **Step 2: Verify red**

Run component test command.

Expected: FAIL, directory absent.

- [ ] **Step 3: Implement editor**

Use useActionState. List Master Item, code/name, version, layer count, total quantity, status, and actions. Dialog editor uses FieldGroup/Field for header. Each layer uses Card with Naik, Turun, Hapus. Requirement rows use Select product, numeric Input quantity, Hapus. Recompute order from array positions before serialize. Show per-layer plus grand total. Available products depend on selected Master Item and exclude duplicate product in current layer. Used row has Badge Dipakai and Alert; edit disabled, clone remains. Publish and clone use AlertDialog. Success/error use Sonner.

Document B101: Layer 1 tube x 3; Layer 2 tube x 5; total 8; publish; packing-session used lock; clone to draft v2.

- [ ] **Step 4: Verify green**

Run component tests, npm run lint, npm run typecheck, npm run build.

Expected: all exit 0.

- [ ] **Step 5: Commit**

  git add src/features/box-definitions/components/box-definition-directory.tsx docs/development/box-definition-management.md
  git commit -m "feat: add box definition editor"

### Task 5: Acceptance and task tracking

**Files:**

- Modify: task.md

- [ ] **Step 1: Browser acceptance**

As admin create B101 from UI, set Layer 1 x3 and Layer 2 x5 using active mapped product, verify total 8, publish, add packing session reference, verify original edit fails, clone, verify v2 draft copied ordered contents.

- [ ] **Step 2: Full verification**

Run database tests, unit/component tests, npm run lint, npm run typecheck, npm run build, and browser flow. Record outputs.

- [ ] **Step 3: Update checklist**

Tick all eight Task 4.6 lines only after Step 2 proves them.

- [ ] **Step 4: Commit**

  git add task.md
  git commit -m "docs: complete box definition task checklist"

## Plan Self-Review

- Spec coverage: Tasks 1-4 implement every Task 4.6 item. Task 5 proves B101 gate.
- Placeholder scan completed. RPC names, files, tests, commands, and payload shape defined.
- Type consistency: actions and UI consume Task 1 input; all RPC names are defined by Task 2.
