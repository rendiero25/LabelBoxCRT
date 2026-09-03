# Box dan Layer bisa disunting setelah kirimannya selesai

## Masalah

Admin tidak bisa mencentang produk pada layer di dialog Edit Master Item.
Checkbox-nya mati, dan tetap mati meski batch label box-nya sudah ditutup.

Penyebabnya satu baris: `disabled={box.isUsed}`, dan `isUsed` berarti "ada
packing session mana pun pada Box ini" — sekali sebuah Box dipakai, ia terkunci
selamanya. Database menegakkan aturan yang sama, jadi membuka kuncinya di layar
saja akan gagal saat disimpan.

Data produksi saat spec ini ditulis: keenam Box milik `GG 3210A-K1Z-NA01-DL` dan
`TB 3210A-K1Z-NF01-DL` terkunci, padahal seluruh 15 packing session berstatus
`confirmed` dan tidak ada satu pun batch yang terbuka.

## Prinsip

> Yang mengunci Box bukan "pernah dipakai", melainkan "masih ada pekerjaan
> berjalan" — dan yang menyudahi pekerjaan adalah batch yang ditutup.

Kalimat pertama sudah dipakai migrasi `20260819140000` untuk Master Item.
Kalimat kedua adalah koreksi yang ditemukan saat menelusuri kode: sebuah session
hanya menjadi `confirmed` ketika print job-nya selesai, dan
`close_label_box_batch` justru *membuat* session berstatus `scanning` untuk box
yang tidak pernah discan. Menutup batch karena itu tidak menyudahi session-nya.
Tanpa koreksi ini, satu cetak yang gagal akan mengunci Box selamanya tanpa jalan
keluar dari layar mana pun.

## Perubahan database

Satu migrasi.

### Predikat bersama

`private.box_has_ongoing_work(p_box_id uuid) returns boolean` — true bila:

- ada `label_box_batches` milik Master Item pemilik Box dengan `closed_at is
  null`; **atau**
- ada `packing_sessions` pada Box itu yang statusnya bukan
  `confirmed`/`cancelled`/`expired` **dan** tidak terhubung ke batch yang sudah
  ditutup lewat `label_boxes.packing_session_id`.

Klausa kedua adalah jaring untuk session yang tidak lahir dari batch. Jumlahnya
nol pada data sekarang, tetapi tanpa itu satu baris nyasar membuka kunci
diam-diam.

### Pemakai predikat

Empat RPC Box mengganti `exists (select 1 from packing_sessions ...)` dengan
predikat itu: `save_box_layer_requirements`, `create_box_layer`,
`delete_box_layer`, `delete_master_item_box`. Kode error tetap
`MASTER_ITEM_BOX_IN_USE`; teks Indonesianya berubah jadi "Box sedang dipakai
kiriman yang belum selesai."

`update_master_item` dan `delete_master_item` memakai aturan yang setara pada
tingkat Master Item: batch terbuka, atau session belum selesai yang tidak
berasal dari batch tertutup. Tanpa penyeragaman ini checkbox produk hidup tetapi
tombol Simpan menolak dengan `MASTER_ITEM_IN_USE` — dua aturan berbeda pada satu
dialog.

### Layer boleh kosong

`save_box_layer_requirements` menerima array kosong: syarat
`jsonb_array_length = 0 → MASTER_ITEM_BOX_INPUT_INVALID` dicabut, `delete`
tetap jalan, `insert` melewati nol baris. Aman karena penutupan batch dan
pembuatan print job sudah mengecualikan box yang layernya tidak meminta produk
apa pun. Tanpa ini admin bisa menambah produk tetapi tidak pernah bisa
membatalkan produk terakhir.

### Soft delete Box

`packing_sessions.box_id` dan `label_boxes.box_id` keduanya `on delete
restrict`, jadi Box yang pernah dikirim tidak bisa dihapus dari tabel. Polanya
mengikuti `master_items`:

- `boxes` mendapat `deleted_at timestamptz` dan `deleted_by uuid`.
- `delete_master_item_box` bercabang: Box berjejak (`packing_sessions` atau
  `label_boxes` mana pun) diarsipkan, Box bersih dihapus betulan seperti
  sekarang.
- `boxes_master_item_box_no_key` menjadi indeks unik parsial `where deleted_at
  is null`, supaya slot Box 1 bisa dipakai lagi setelah Box 1 lama diarsipkan.
  `box_code` tidak perlu diubah karena nilainya dari sequence.
- Pemilih slot di `create_master_item_box`, hitungan box dan `cross join
  public.boxes` di `create_label_box_batch`, serta policy select `boxes`
  menambah `deleted_at is null`. Pembaca riwayat lewat `session.box_id` sengaja
  tidak disaring — justru itu gunanya baris jangkar.

## Perubahan aplikasi

- `src/features/master-items/box-lock.ts` (baru): fungsi murni yang menurunkan
  `hasOngoingWork` dan `hasHistory` sebuah Box dari baris session, label box,
  dan batch. Ditaruh terpisah supaya bisa diuji tanpa database, sejalan dengan
  `box-layer-requirements.ts`.
- `src/app/admin/master-items/page.tsx`: query menarik `packing_sessions(id,
  status)` dan `label_boxes(batch_id)` selain batch terbuka per Master Item,
  menyaring Box `deleted_at is null`, lalu mengirim kedua nilai turunan itu
  menggantikan `isUsed`.
- `master-item-box-layer-editor.tsx`: `disabled={box.isUsed}` menjadi
  `disabled={box.hasOngoingWork}`. Lencana "Terpakai" dipecah dua: "Sedang
  dipakai" yang mengunci, dan "Pernah dipakai" yang hanya keterangan.
- `box-layer-requirements.ts`: `parseLayerRequirementsPayload` berhenti membuang
  entri berdaftar kosong, supaya uncheck terakhir tersimpan.

## Pengujian

pgTAP `supabase/tests/database/034_box_edit_after_batch_closed.test.sql`:

- batch terbuka menolak penyuntingan layer;
- batch tertutup dengan session `confirmed` menerima;
- batch tertutup dengan session `print_failed` menerima;
- layer yang dikosongkan tersimpan;
- hapus Box berjejak mengarsipkan, hapus Box bersih menghapus;
- slot Box bisa dipakai ulang setelah Box lama diarsipkan.

Vitest: `box-lock.test.ts` untuk turunan kunci, dan kasus daftar kosong
ditambahkan ke `box-layer-requirements.test.ts`.

## Sengaja tidak dikerjakan

Membuat produk atau ukuran baru dari dalam editor box layer — daftarnya tetap
berasal dari halaman Products. Versioning Box juga tidak dibuat; riwayat sudah
dijaga oleh snapshot pada `label_box_batches` dan `print_jobs`.
