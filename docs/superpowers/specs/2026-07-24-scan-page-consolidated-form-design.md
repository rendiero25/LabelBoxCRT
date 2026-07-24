# Scan Page Redesign — Consolidated Form, Auto Finalize/Print, QR Label

Date: 2026-07-24
Status: Approved (user, 2026-07-24)

## 1. Data model

Migration adds:
- `packing_sessions.qty_delivery integer` — manual input, captured at session start.
- `packing_sessions.lot_no text` — manual input, captured at session start.
- `print_jobs.qty_delivery_snapshot integer`, `print_jobs.lot_no_snapshot text`, `print_jobs.qr_generated_at_snapshot timestamptz` — copied at finalize, same snapshot pattern as `supplier_code_snapshot` etc.
- `delivery_numbers.delivery_number` gains an auto-generate path (new sequence, same pattern as `master_item_code_seq`) for when the operator doesn't supply one.

RPC changes:
- `start_packing_session` gains `p_qty_delivery integer`, `p_lot_no text`, `p_supplier_id uuid`, `p_delivery_date date`. It resolves the Delivery Number itself (find an active DN for that supplier + date, else auto-create one with a generated code) and stores the result in `packing_sessions.delivery_number_id` immediately (that column already exists, currently only set at finalize — this moves it earlier).
- `finalize_packing_session` drops its `p_delivery_number_id` parameter; it reads the id already on the session row instead. Otherwise unchanged, plus copies the two new fields (+ `now()` for `qr_generated_at_snapshot`) into the print job snapshot.

## 2. Consolidated start form

Single form, top to bottom: Supplier (select) → Master Item (select, filtered to `supplier_id` match) → Box (select, unchanged) → Qty delivery (number input) → Lot No (text input) → Delivery date (date input). Packing qty shown read-only from `master_items.default_label_qty`.

Delivery Number is resolved server-side from Supplier + Delivery date; no DN code field in this form.

## 3. Scan validation

No RPC logic changes. `accept_packing_scan` already enforces: product must be mapped to the session's Master Item (`master_item_products`), size must match (`normalized_dimensions`), and there must be remaining capacity in a box layer requiring that product. Reused as-is.

## 4. Auto finalize + auto print

When session status flips to `ready_to_finalize` (existing computed state), the client calls `finalizePackingSessionAction` automatically — no button, no delivery number to pick (already resolved at session start, see §1). `PrintJobCard`'s existing auto-print effect (QZ connected + printer selected) then fires unchanged. If QZ/printer isn't ready, the existing manual "Print label" fallback card still applies.

## 5. Scan error toast

On `result: "invalid"` scans, show a red sonner toast with `duration: Infinity` and a visible close button — stays until the operator dismisses it. The existing inline scan-status banner (all results) is unchanged; the toast is additive, for errors only.

## 6. QR code on label

ZPL template v2: append a `^BQ` (Zebra native QR) block — no external QR library. Content, pipe-separated:

```
{supplierCode} | {partNo} | {packingQty} | {labelReference} | {qrGeneratedAt}
```

`labelReference` reuses the existing `sequence-DDMMYY-boxCode` value already on the label. `TEMPLATE_VERSION` bumps to `v2`.

## 7. Cleanup

Remove the "Phase 5" label from `StartSessionForm` and `SessionListView` in `packing-scan-console.tsx`.

## Out of scope

- Changing `accept_packing_scan` validation logic itself.
- Reprint flow changes.
- Delivery Number admin page UI (auto-generated codes only affect the scan-page path).
