# Design: Box Restructure into Master Item, Master Item Form Cleanup, Delivery Number → Scan

Date: 2026-07-23

## Summary

Box stops being standalone shared master data (`boxes` + `master_item_boxes` join/versioning). Each Master Item now owns up to 3 Box slots directly, auto-named/auto-coded, with nested Layers and per-layer product requirements. Master Item form drops "Kode sequence opsional" and renames "Default Label Qty" to "Packing Qty". Delivery Number admin CRUD moves into the operator Scan page. Master Item list gets filter/sort (ported from Box directory pattern).

Data reset accepted (dev-stage data, no migration script needed).

## 1. Data Model

- `boxes`: add `master_item_id` (FK, not null), `box_no` (int 1-3, unique per `master_item_id`). `box_name` = `'Box ' || box_no`. Keep global auto `box_code` (`box-NN`) as the unique Box ID.
- Drop `master_item_boxes` (versioning/publish/clone) entirely.
- `box_layers`: unchanged shape (`box_id`, `layer_no`, `sort_order`), `layer_name` = `'Box ' || box_no || ' - Layer ' || layer_no`. Max 10 layers/box (existing limit, unchanged).
- `box_layer_requirements`: re-point FK from `master_item_box_id` → `box_layer_id` directly (drop the version indirection).
- `packing_sessions.master_item_box_id` → rename to `box_id`, FK → `boxes.id` directly.
- `master_items.item_sequence_code`: drop column.
- Box slot reuse: on create, assign lowest free `box_no` in {1,2,3}. Max 3 boxes/item enforced in RPC.
- Lock rule preserved: once a box has any packing session, its layers/requirements become read-only (existing `box_in_use` check pattern), and the box itself can't be deleted.
- `delivery_numbers` table: unchanged shape.
- Migration approach: single new migration drops old objects (`master_item_boxes`, related RPCs, `item_sequence_code` column) and creates the new shape. No data migration — reset accepted.

## 2. RPC Changes

New/changed (all `security definer`, gated by `private.is_active_admin()`, write `audit_logs`, same as existing conventions):
- `create_master_item_box(p_master_item_id)` — auto box_no/name/code, reject if 3 active boxes exist.
- `delete_master_item_box(p_box_id)` — cascades layers/requirements, reject if in use.
- `create_box_layer(p_box_id)` / `delete_box_layer(p_box_layer_id)` — reject past 10 layers or if in use.
- `save_box_layer_requirements(p_box_layer_id, p_requirements[])` — replaces `save_master_item_box_requirements`.
- `create_master_item` / `update_master_item` — drop `p_item_sequence_code` param.
- Delivery Number RPCs (`create_delivery_number`, `update_delivery_number`, `close_or_cancel_delivery_number`): gate changes from `is_active_admin()` to `requireOperator` (callable by active operator).

Removed: `create_master_item_box` (old assign-existing-box variant), `publish_master_item_box`, `clone_master_item_box_version`, `create_box`, `update_box`, `set_box_active`, `delete_box` (standalone box-directory RPCs).

Repointed: scan RPC(s), `finalize_packing_session`, print RPCs — all `master_item_box_id`/`master_item_boxes` joins become `box_id`/`boxes` joins.

Label format (`formatLabelFields`, `print_jobs` snapshots): box reference string becomes `"{item_code} - Box {box_no}"`; layer-level reference `"{item_code} - Box {box_no} - Layer {layer_no}"`.

## 3. UI Changes

**Master Item directory** (`src/features/master-items/components/master-item-directory.tsx`):
- Label "Default label Qty" → "Packing Qty" (field/validation unchanged otherwise).
- Remove "Kode sequence opsional" field from form + "Sequence" column from table.
- Add filter Popover + sort Popover + `PaginationControls` to toolbar, ported from `src/features/boxes/components/box-directory.tsx`.
- Replace `MasterItemBoxLayerEditor` (draft/publish/clone assign-box flow) with a direct nested editor: up to 3 Box cards (readonly auto id/name, "Tambah Box" disabled at 3), each with "Tambah Layer" (readonly auto name, max 10), each layer expandable to manage product+qty requirements. In-use boxes/layers show a "Terpakai" badge and are read-only.

**Removed**: `/admin/boxes` route, `src/features/boxes/*`, "Box" sidebar entry (`src/app/admin/layout.tsx`).

**Delivery Number**: remove `/admin/delivery-numbers` route, `src/features/delivery-numbers/components/delivery-number-directory.tsx`, sidebar entry. Add a "Buat Delivery Number" dialog (supplier, number, date) into `src/components/operator/packing-scan-console.tsx` next to the existing active-delivery-number picker, calling the repointed actions.

## 4. Out of Scope

- No public/unauthenticated web page for Box/Layer — "public" naming is label-string format only (already covered in RPC section).
- No new User/Operator admin page — Delivery Number moves to Scan page, not to a profiles CRUD page.
- No data migration script — existing Box/Master Item Box data is dropped.
