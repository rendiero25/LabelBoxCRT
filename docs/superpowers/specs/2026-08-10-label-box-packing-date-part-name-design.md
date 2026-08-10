# Label Box: Packing Date field + fixed Part Name row

Concise spec — implementation-ready, not a tutorial.

## Scope

1. New **Packing Date** field (real per-batch date) on the label box create/edit
   forms, printed above **Delivery Date** on the label.
2. New **Part Name** row on the printed label, fixed constant value `"Tube"`
   (not read from any table), printed below **Part No**.

Non-goals: `label_boxes.qr_payload` format is unchanged (Packing Date is not
encoded into it); no changes to the verification console, CSV import, or
admin batch list table.

## 1. Packing Date — data model

`label_box_batches` gets its own `packing_date date not null` column — a
batch-owned fact like `lot_no`/`packing_qty`, not a denormalized `_snapshot`
copy (there's no `delivery_numbers`-style shared registry for it).

Migration:
- `alter table label_box_batches add column packing_date date;`
- Backfill existing rows: `update label_box_batches set packing_date = delivery_date_snapshot where packing_date is null;`
- `alter table label_box_batches alter column packing_date set not null;`

`print_jobs` gets `packing_date_snapshot date not null`, following the exact
same lifecycle as `delivery_date_snapshot`:
- Set at creation time in `create_label_box_print_jobs` from `target_batch.packing_date`.
- Rewritten by `update_label_box_batch`'s existing print_jobs `UPDATE` (the one
  that already sets `lot_no_snapshot`/`delivery_number_snapshot`/`delivery_date_snapshot`)
  — add `packing_date_snapshot = target_batch.packing_date` to that same `SET`.
- Copied verbatim from `parent_job.packing_date_snapshot` in
  `create_label_box_reprint_jobs` (same pattern as its other `*_snapshot` copies).

## 2. RPC signature changes

- `create_label_box_batch(...)`: add `p_packing_date date` (required). Validate
  `if p_packing_date is null then raise ... 'PACKING_DATE_INVALID'` (same shape
  as the existing `DELIVERY_DATE_INVALID` check). Insert into
  `label_box_batches.packing_date`. Add `packing_date` to `RETURNS TABLE` and
  the final `select`.
- `update_label_box_batch(...)`: add `p_packing_date date` (required), same
  validation. Update `label_box_batches.packing_date`. Add
  `packing_date_snapshot = target_batch.packing_date` to the print_jobs
  propagation `UPDATE`. Add `packing_date` to `RETURNS TABLE`/`select`.
- `create_label_box_print_jobs(uuid)`: insert `packing_date_snapshot` from
  `target_batch.packing_date`; add `packing_date` to `RETURNS TABLE` and final
  `select` (from `job.packing_date_snapshot`).
- `create_label_box_reprint_jobs(...)`: copy `packing_date_snapshot` from
  `parent_job.packing_date_snapshot` in the insert; add `packing_date` to
  `RETURNS TABLE`/`select`.

New error code: `PACKING_DATE_INVALID` → add to `safeRpcMessages` in
`src/features/label-boxes/actions.ts`: `"Tanggal Packing tidak valid."`

After migrations: regenerate `src/types/database.ts`
(`cmd.exe /d /s /c "npx.cmd supabase gen types typescript --linked --schema public > src\types\database.ts"`).

## 3. App layer plumbing

- `src/features/label-boxes/actions.ts`: `deliveryFieldsFromFormData` also
  reads/validates `packingDate` (reuse `isIsoDate`), and both
  `createLabelBoxBatchAction`/`updateLabelBoxBatchAction` pass
  `p_packing_date` to their RPC calls.
- `src/features/label-boxes/form-state.ts`: add `packingDate: string` to
  `LabelBoxBatchResult`.
- `src/features/label-boxes/components/label-box-batch-dialog.tsx`: new
  `Field` "Packing Date" (`type="date"`, required, default today's date),
  placed directly above the Delivery Number/Delivery Date grid.
- `src/features/label-boxes/components/label-box-batch-row-actions.tsx`: add
  `packingDate` to `LabelBoxBatchEditable`, and the same Packing Date input
  (pre-filled) to `EditLabelBoxBatchDialog`, submitted as `packingDate`.
- `src/features/label-boxes/components/label-box-batch-table.tsx`:
  `LabelBoxBatchRow` (which `batch={batch}` passes straight into
  `EditLabelBoxBatchDialog`, so it must satisfy `LabelBoxBatchEditable`) gets
  a `packingDate` field.
- `src/app/(operator)/scan/page.tsx`: add `packing_date` to the
  `label_box_batches` `.select(...)` column list and map it in
  `toLabelBoxBatchRow`.
- `src/features/label-boxes/verification-form-state.ts`: add
  `packingDate: string` to `LabelBoxPrintJob`.
- `src/features/label-boxes/verification-actions.ts`: map
  `packingDate: row.packing_date` in both `createLabelBoxPrintJobsAction` and
  `createLabelBoxReprintJobsAction`.
- `src/features/label-boxes/components/label-box-batch-print-card.tsx`: pass
  `packingDate: job.packingDate` into the `formatLabelFields({...})` call.

## 4. Label formatting + layout

`src/lib/label/formatter.ts`: add `packingDate: string` to
`FinalizedLabelSnapshot` and `FormattedLabelFields`; in `formatLabelFields`,
`packingDate: formatShortDate(snapshot.packingDate)` (same DD-MM-YYYY as
Delivery Date).

`src/lib/label/zpl.ts` (`labelRowsFor` — single source shared by `html.ts`):
row order becomes:

```
Customer, Supplier ID, Part No, Part Name (NEW, fixed "Tube", VALUE_FONT, not bold),
Qty/Box, Qty/Delivery, Packing Date (NEW, VALUE_FONT, not bold — same styling as
Delivery Date), Delivery Date, Lot No, Operator Pack, QC Passes
```

`ROW_COUNT` 9 → 11. `ROW_HEIGHT` 40 → 33 dots (uniform shrink, header
untouched at 60). Fits: `11 × 33 = 363` ≤ available `364` dots
(`FRAME_HEIGHT 424 − HEADER_HEIGHT 60`). Every other layout constant
(`QR_COLUMN_BOTTOM`, `MONTH_TOP/BOTTOM`, `FIFO_BOTTOM`, `FULL_WIDTH_ROW_TOP`,
etc.) is already derived from `ROW_HEIGHT`/`ROW_COUNT` — no hardcoded
duplicates to hunt down.

Scale all row fonts by `33/40 = 0.825` (round to nearest dot):
`LABEL_FONT` 12/6 → 10/5, `VALUE_FONT` 28/14 → 23/12, `PART_NO_FONT` 32/13 →
26/11, `FIFO_FONT` 24/12 → 20/10, `MONTH_FONT` 62/34 → scale by new 2-row span
(66 vs 80 dots) → 51/28. Treat these as a starting point, not final — verify
visually/on hardware and nudge if any row's text is clipped or looks off.

Bump `TEMPLATE_VERSION` → `"v8"` and `HTML_TEMPLATE_VERSION` → `"v8-html"`.
Add a one-line version-history comment entry (matches the existing v1–v7 log
at the top of `zpl.ts`).

## 5. Testing

- pgTAP: extend `supabase/tests/database/019_label_box_batch.test.sql` and
  `021_label_box_batch_edit_delete.test.sql` with `packing_date`
  create/update/validation assertions; extend the print-job RPC test(s) to
  assert `packing_date`/`packing_date_snapshot` propagation and reprint copy.
- Unit: `src/lib/label/formatter.test.ts`, `src/lib/label/zpl.test.ts` (update
  `__snapshots__/zpl.test.ts.snap`), `src/lib/label/html.test.ts`.
- Manual/hardware: print a real label on the ZD220 and on the Canon G4010
  paper path after implementation — confirm all 11 rows are legible at the
  new row height before this is considered production-ready (this repo's
  Definition of Done requires ZD220 hardware verification for label changes;
  it cannot be confirmed from code alone).
