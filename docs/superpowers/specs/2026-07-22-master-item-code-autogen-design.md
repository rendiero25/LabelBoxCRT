# Master Item Code Auto-Generation — Design

Status: approved by project owner (Rendiero), 22 Juli 2026, via brainstorming skill.

## Rationale

Owner decision: the "Kode item" field on the Master Item admin form (create + edit) must no
longer be a manually typed value. The system generates it automatically and the field is not
editable by the user, in either the create or the edit dialog. CSV import of master items keeps
supplying `item_code` from the file as it does today — this change is scoped to the admin form
flow only.

## Decisions locked

- **Format**: `mstritem-` + a 2-digit zero-padded sequential number, starting at `mstritem-01`.
  After the counter passes 99 the number widens without truncation (`mstritem-100`,
  `mstritem-101`, ...); no re-padding to 3 digits is applied.
- **Numbering source**: a dedicated Postgres sequence (`public.master_item_code_seq`), not a
  `max(...)+1` query, to guarantee atomicity/uniqueness under concurrent creates — the same
  pattern already used for `print_job_sequence` in `finalize_packing_session`.
- **Scope**: only the admin "Buat Master Item" / "Edit Master Item" form is affected. CSV import
  (`import_csv_master_data` → `master_item` template) keeps requiring and validating `item_code`
  from the uploaded file exactly as it does today — no behavior change there.
- **Edit is fully locked**: once created, `item_code` can never change through the admin UI,
  regardless of who edits the Master Item.

## Database changes

New migration `supabase/migrations/<ts>_master_item_code_autogen.sql`:

- `create sequence public.master_item_code_seq start with 1;`
- `create or replace function public.create_master_item(...)`: change `p_item_code text` to
  `p_item_code text default null`. Signature's other parameter types are unchanged, so this is a
  plain `create or replace` (no `drop function` needed — adding a trailing default to an already-
  last-optional-adjacent position; existing callers that always pass 6 positional args, like CSV
  import, are unaffected since they still supply a value for it).
  - Body: if `p_item_code` is `null` or blank after `btrim`, generate
    `'mstritem-' || lpad(nextval('public.master_item_code_seq')::text, 2, '0')` and skip the
    format-regex check for it (a generated code always matches the constraint pattern).
  - If `p_item_code` is non-blank (CSV import path), keep the existing normalize
    (`lower(btrim(...))`) + `^[a-z0-9][a-z0-9_-]{1,63}$` validation exactly as today.
  - `MASTER_ITEM_CODE_EXISTS` unique-violation handling stays as a safety net for both paths.
- `update_master_item`: drop the `p_item_code` parameter entirely. Because this removes a
  parameter (not just adds a default), the migration must `drop function` the old 7-arg overload
  first, then `create or replace` the new 6-arg version — same pattern as
  `20260721093000_remove_workstation_from_master_item_box_rpcs.sql`. The `UPDATE ... SET` clause
  drops `item_code = normalized_item_code`; `item_code` is no longer settable through this RPC at
  all. Re-issue `revoke`/`grant execute` for the new signature.
- `import_csv_master_data`'s call to `create_master_item(...)` is unchanged — it still passes
  `item_code` positionally as the first argument, which continues to work because the parameter
  only gained a default, it didn't move or change type.

## Application changes

- `src/features/master-items/validation.ts`:
  - Remove `itemCode` from `MasterItemInput`, drop `itemCodePattern`, drop the item-code parsing
    block and its error message from `parseMasterItemInput`.
  - `masterItemRpcErrorMessage` keeps the `MASTER_ITEM_CODE_EXISTS` mapping (still reachable via
    CSV import and as a defensive fallback on the auto-generate path).
- `src/features/master-items/actions.ts`:
  - `createMasterItemAction`: call `create_master_item` with `p_item_code: null` (the server
    always requests auto-generation for the admin-form path; the RPC handles CSV import
    separately with its own explicit value).
  - `updateMasterItemAction`: stop sending `p_item_code` to `update_master_item` at all.
- `src/features/master-items/components/master-item-directory.tsx` (`MasterItemForm`):
  - Create mode (`masterItem` undefined): replace the "Kode item" `Input` with a disabled/static
    field (no `name` attribute, so nothing is submitted) showing helper copy, e.g. "Dibuat
    otomatis setelah disimpan".
  - Edit mode (`masterItem` present): render "Kode item" as `Input disabled` pre-filled with
    `masterItem.item_code`, no `name` attribute (so it's never part of the submitted `FormData`
    even if `disabled` were ever removed by mistake), with a short note that it can't be changed.
  - Keep the existing 2-column grid (Kode item + Part No) in both modes for layout consistency.
- Regenerate `src/types/database.ts` after the migration lands (RPC signatures changed).

## Error handling

- No new error codes. `MASTER_ITEM_CODE_EXISTS` remains the only item-code-related RPC error,
  now realistically only reachable via CSV import or a sequence/unique-index race (defensive).
- The admin form no longer has an item-code validation error path since the user never supplies
  one.

## Testing

- `src/features/master-items/validation.test.ts`: remove `itemCode` from the existing
  `parseMasterItemInput` fixtures/assertions.
- New pgTAP coverage (extend `supabase/tests/database/003_phase_2_seed.test.sql` or add to the
  master-item admin CRUD test file — whichever already covers `create_master_item`/
  `update_master_item`):
  - `create_master_item` called with `p_item_code := null` produces a code matching
    `^mstritem-\d+$`, and two consecutive calls produce distinct, incrementing codes.
  - `create_master_item` called with an explicit `p_item_code` (simulating CSV import) still
    uses that exact value and still enforces the existing format/uniqueness rules.
  - `update_master_item`'s new signature has no `p_item_code` parameter; calling it does not
    change `item_code` on the row (assert `item_code` unchanged after an otherwise-valid update).
- `npm run typecheck`, `npm run lint`, `npm test` after application changes.
- pgTAP full suite against the hosted dev project after the migration lands, plus advisors.
- Manual UAT: open Buat Master Item dialog (no code field to fill, item_code visible after save
  starts at `mstritem-01` or continues the existing sequence), open Edit dialog on that item
  (code shown, disabled, unchangeable), and run a CSV import of a `master_item` template file to
  confirm item_code from the file is still honored.

## Non-goals

- Does not touch CSV import's `item_code` requirement/validation/duplicate-detection — untouched.
- Does not backfill or rename `item_code` values on existing Master Items.
- Does not change `item_sequence_code` (separate, still-manual metadata field, unaffected).
