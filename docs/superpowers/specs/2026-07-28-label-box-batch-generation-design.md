# Label Box Batch Generation — Design

**Goal:** Ganti alur scan per-box dengan alur batch: operator mengisi satu form delivery, sistem menggenerate seluruh nomor label box beserta QR payload sekaligus, dan halaman Scan menampilkannya sebagai tabel. Verifikasi (scanning) adalah task berikutnya.

**Status:** disetujui 2026-07-28. Menggantikan alur `start_packing_session` → scan → `finalize_packing_session` sebagai jalur utama halaman Scan.

---

## Keputusan yang dikunci

- Alur lama **diganti total** di halaman Scan. `packing-scan-console.tsx` disimpan (tidak dirender) karena UI scanning-nya dipakai ulang saat task Verifikasi.
- Delivery Number **diketik manual** oleh operator, bukan auto-generate. Auto-DN di `start_packing_session` tetap ada di database tapi tidak dipakai jalur baru.
- Label **belum dicetak** saat generate. Print job dibuat di task Verifikasi.
- QR ditampilkan sebagai **teks payload per label + satu QR kecil** sebagai contoh visual.
- Form tambah berupa **dialog 3 langkah**, bukan halaman terpisah.

## Aturan bisnis

- `set_count = qty_delivery / packing_qty` — wajib bulat, sisa ditolak (`QTY_DELIVERY_NOT_MULTIPLE`)
- `label_count = set_count × jumlah box master item` (box `box_no` 1..3)
- `box_number = 'B' || box_no || lpad(set_no, 2, '0')` → B101, B201, B301 (set 1), B102, B202, B302 (set 2)
- `set_no` maksimal 99 karena format 2 digit → `qty_delivery ≤ 99 × packing_qty`
- `packing_qty` disnapshot dari `master_items.default_label_qty` saat generate
- `master_item_row_no` = `row_number() over (order by item_code)` saat generate, disimpan permanen
- DN dicari dengan `supplier_id` + nomor (unique index yang ada). Ketemu → dipakai ulang, tanggal wajib sama; belum ada → dibuat dengan `status = 'active'`
- QR payload 7 field pipe: `kodeSupplier|partNo|packingQty|masterItemRowNo|lotNo|boxNumber|tglDelivery(DD-MM-YYYY)`
  Contoh: `10015|PN-0001|100|1|LOT-A|B101|24-07-2026`

**Risiko diterima:** `master_item_row_no` adalah posisi baris saat generate. Kalau ada master item dihapus, nomor di label lama tidak lagi cocok dengan posisi baris saat ini. Operator memilih perilaku ini secara sadar; snapshot di batch mencegah nilai berubah setelah tercetak.

## Skema

```sql
create table public.label_box_batches (
  id uuid primary key default gen_random_uuid(),
  delivery_number_id uuid not null references public.delivery_numbers (id) on delete restrict,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  master_item_id uuid not null references public.master_items (id) on delete restrict,
  master_item_row_no integer not null check (master_item_row_no > 0),
  packing_qty integer not null check (packing_qty > 0),
  qty_delivery integer not null check (qty_delivery > 0),
  lot_no text not null check (btrim(lot_no) <> ''),
  label_count integer not null check (label_count > 0),
  qr_generated_at timestamptz,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type public.label_box_status as enum ('generated', 'verified');

create table public.label_boxes (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.label_box_batches (id) on delete cascade,
  box_id uuid not null references public.boxes (id) on delete restrict,
  box_no integer not null check (box_no between 1 and 3),
  set_no integer not null check (set_no between 1 and 99),
  box_number text not null check (btrim(box_number) <> ''),
  qr_payload text not null check (btrim(qr_payload) <> ''),
  status public.label_box_status not null default 'generated',
  created_at timestamptz not null default now(),
  unique (batch_id, box_number)
);
```

RLS: operator dan admin boleh `select` semua batch dan label. Tulis hanya lewat RPC.

## RPC

```
create_label_box_batch(
  p_supplier_id uuid, p_delivery_number text, p_delivery_date date,
  p_master_item_id uuid, p_qty_delivery integer, p_lot_no text
)
```

`SECURITY DEFINER`, operator aktif saja, satu transaksi. Urutan:

1. Validasi operator, supplier aktif, master item aktif, supplier master item cocok
2. Resolusi DN (cari atau buat)
3. Ambil box master item; nol box → tolak
4. Validasi qty delivery kelipatan `packing_qty` dan `set_count ≤ 99`
5. Hitung `master_item_row_no`
6. Insert batch, lalu label box untuk tiap (set × box), rakit `qr_payload` di SQL
7. Stempel `qr_generated_at`, tulis `audit_logs`

Kode error: `LABEL_BOX_OPERATOR_REQUIRED` · `SUPPLIER_INVALID` · `MASTER_ITEM_NOT_ACTIVE` · `MASTER_ITEM_SUPPLIER_MISMATCH` · `MASTER_ITEM_HAS_NO_BOX` · `DELIVERY_NUMBER_INVALID` · `DELIVERY_NUMBER_DATE_MISMATCH` · `DELIVERY_DATE_INVALID` · `QTY_DELIVERY_INVALID` · `QTY_DELIVERY_NOT_MULTIPLE` · `LOT_NO_INVALID`

## UI

Halaman `/scan` = tabel batch + tombol Tambah.

Kolom: DN · Tanggal · Kode Supplier · Kode Master Item · Packing Qty · Qty Delivery · Lot No · Jumlah Label · Status QR · Verifikasi (nonaktif, task berikutnya). Baris bisa dibuka untuk melihat daftar nomor box.

Dialog Tambah, 3 langkah:

1. **Form** — DN (teks), Tanggal DN (date), Supplier (dropdown kode), Master Item (dropdown kode), Packing Qty (terkunci, ikut master item), Qty Delivery, Lot No. Tombol Simpan + Batal
2. **Hasil** — daftar nomor box, payload QR per box sebagai teks, satu QR kecil sebagai contoh
3. **Selesai** — tutup dialog, refresh tabel

Dependency baru: `qrcode` untuk merender satu QR contoh di layar.

## Error handling

- Action Next.js menolak bentuk yang jelas salah sebelum ke DB; RPC pemegang keputusan akhir
- RPC atomik: gagal di tengah = tidak ada batch/label tersisa, dialog kembali ke langkah 1 dengan pesan error
- Pesan error Indonesia dipetakan dari kode RPC, pola sama dengan `src/features/scan/actions.ts`

## Testing

- **pgTAP** `019_label_box_batch.test.sql` — penomoran B101/B201/B301/B102, `label_count`, qty bukan kelipatan ditolak, DN dipakai ulang, DN tanggal beda ditolak, master item tanpa box ditolak, anon tanpa execute
- **Vitest** — perakit QR payload 7 field dan pemformat nomor box, termasuk batas set 99
- **Manual** — dialog 3 langkah, tabel, QR kecil terbaca scanner
