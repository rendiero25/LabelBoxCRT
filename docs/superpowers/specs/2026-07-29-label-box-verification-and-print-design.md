# Label Box Verification and Print — Design

**Goal:** Lengkapi alur label box: operator memverifikasi isi box dengan scan produk, menutup batch, lalu mencetak seluruh label sekaligus. Sekaligus membuang sisa alur packing session lama.

**Status:** disetujui 2026-07-29. Lanjutan dari `2026-07-28-label-box-batch-generation-design.md`.

---

## Keputusan yang dikunci

- Operator scan terus-menerus; **sistem** yang memilih box tujuan — nomor terkecil yang layernya belum penuh
- Cetak dilakukan **sekaligus setelah batch ditutup**, bukan per box
- Batch wajib ditutup operator sebelum boleh dicetak, walau nol produk discan
- Semua label dicetak apa adanya, termasuk box yang belum penuh
- Perekaman scan **memakai ulang** `packing_sessions` + `accept_packing_scan` yang sudah teruji
- Kode alur lama dibuang di task terakhir, setelah alur baru hijau

## Skema

```sql
alter table public.label_box_batches
  add column closed_at timestamptz,
  add column closed_by uuid references public.profiles (id) on delete restrict;

alter table public.label_boxes
  add column packing_session_id uuid references public.packing_sessions (id) on delete restrict;

alter table public.print_jobs
  add column qr_payload_snapshot text;
```

Status batch dibaca dari `closed_at`: null berarti terbuka. Status tercetak dibaca dari keberadaan `print_jobs`.

`label_boxes.status` tetap `generated` → `verified`. Box terisi sebagian tetap `generated`; kemajuannya dihitung dari `packing_session_scans` yang diterima.

## RPC

**`accept_label_box_scan(p_batch_id uuid, p_label_uid text, p_normalized_size text, p_raw_payload_hash text, p_scanned_size text)`**

1. Batch ada dan `closed_at is null`, else `LABEL_BOX_BATCH_NOT_FOUND` / `LABEL_BOX_BATCH_CLOSED`
2. Pilih label box target: `set_no`, lalu `box_no` terkecil yang belum `verified`. Tidak ada → `NO_LABEL_BOX_AVAILABLE`
3. Belum punya `packing_session_id` → buat sesi untuk `label_boxes.box_id`, simpan pautannya
4. Delegasikan ke `accept_packing_scan`, teruskan hasil dan kode errornya apa adanya
5. Sesi mencapai `ready_to_finalize` → `label_boxes.status = 'verified'`

**`close_label_box_batch(p_batch_id uuid)`**

Stempel `closed_at`/`closed_by`. Untuk tiap label box tanpa sesi, buatkan satu atas nama penutup — `print_jobs.packing_session_id` wajib terisi. Sudah tertutup → `LABEL_BOX_BATCH_ALREADY_CLOSED`.

**`create_label_box_print_jobs(p_batch_id uuid)`**

Batch harus tertutup, else `LABEL_BOX_BATCH_NOT_CLOSED`. Satu `print_jobs` per label box:

- snapshot supplier, part, qty, DN, tanggal, lot diambil dari `label_box_batches`
- `box_code_snapshot` = `label_boxes.box_number`
- `label_reference` = `{urut}-{DDMMYY}-{nomor box}`
- `qr_payload_snapshot` = `label_boxes.qr_payload` apa adanya
- `template_version` = `v3`

Idempoten: dipanggil ulang mengembalikan job yang sudah ada, tidak menggandakan.

Semua `security definer`, `set search_path = pg_catalog`, operator aktif saja.

## UI

Rute baru `src/app/(operator)/scan/[batchId]/verifikasi/page.tsx`, halaman penuh:

- Header batch: DN, supplier, master item, lot, qty delivery
- Daftar label box dengan progress per box, box aktif ditandai
- Blok scan besar: status scan terakhir, bunyi, tombol bisu
- Panel scan terakhir
- Tombol **Selesaikan verifikasi**

Tabel batch bertambah kolom status dan aksi kondisional:

| Keadaan | Aksi |
|---|---|
| `closed_at` null | **Verifikasi** |
| tertutup, belum ada print job | **Cetak** |
| sudah ada print job | **Cetak ulang** |

Dipakai ulang: hook `useScannerListener`, `acceptPackingScanAction`, `PrintJobCard`, dan infrastruktur tanda tangan QZ.

## ZPL v3

`buildLabelZpl` berhenti merakit QR sendiri; ia menerima payload jadi dan memasangnya ke blok `^BQ`. Tata letak tujuh baris teks tidak berubah. Snapshot emas diperbarui.

## Pembuangan kode lama

Dilakukan sebagai task terakhir, setelah alur baru hijau:

- `src/components/operator/packing-scan-console.tsx`
- `startPackingSessionAction` di `src/features/scan/actions.ts` — `acceptPackingScanAction` tetap
- `src/features/finalize/actions.ts`; tipe `FinalizeSnapshot` pindah menyertai `PrintJobCard`
- RPC `start_packing_session` dan `finalize_packing_session`
- pgTAP `015` dihapus, `014` ditulis ulang tanpa `start_packing_session`

`PrintJobCard` dan QZ **tidak** dibuang.

## Error

`LABEL_BOX_BATCH_NOT_FOUND` · `LABEL_BOX_BATCH_CLOSED` · `LABEL_BOX_BATCH_ALREADY_CLOSED` · `LABEL_BOX_BATCH_NOT_CLOSED` · `NO_LABEL_BOX_AVAILABLE` · ditambah kode `accept_packing_scan` yang diteruskan.

Scan ditolak muncul sebagai toast merah bertahan sampai ditutup.

## Testing

- pgTAP `020_label_box_verification.test.sql` — pemilihan box target, pindah ke box berikutnya saat penuh, tolak scan pada batch tertutup, tutup batch membuat sesi untuk box kosong, satu `print_jobs` per box dengan `qr_payload_snapshot` sama persis, pemanggilan ulang tidak menggandakan
- pgTAP `014` ditulis ulang
- Vitest — ZPL v3 memakai payload tersimpan, snapshot emas baru
- Manual — scan dengan scanner sungguhan, cetak ke Zebra
