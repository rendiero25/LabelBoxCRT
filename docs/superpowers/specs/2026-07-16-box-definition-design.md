# Box Definition Admin — Design

## Scope

Menyelesaikan Task 4.6 agar admin dapat membuat dan mengelola definisi box tanpa database console. Scope mencakup create box, layer dan requirement produk, validasi quantity, ringkasan total, publish/activate, new-version flow, dan read-only untuk versi yang telah dipakai packing session.

## Lifecycle

1. Admin membuat box definition berstatus draft (`is_active = false`) untuk satu Master Item, dengan box code, box name, dan version awal `1`.
2. Admin menambah, menghapus, dan mengurutkan layer. Nomor serta urutan layer disimpan konsisten dan unik per definition.
3. Pada setiap layer, admin menambah requirement produk dan `expected_qty` positif. Produk harus merupakan mapping aktif untuk Master Item box.
4. Editor menghitung total quantity seluruh requirement dan menampilkan ringkasan per layer.
5. Publish hanya tersedia ketika definition valid: Master Item aktif, minimal satu layer aktif, setiap layer aktif mempunyai requirement, setiap requirement memakai produk yang dipetakan, dan semua quantity positif.
6. Aktivasi memakai database function atomik yang menonaktifkan versi aktif lain untuk Master Item dan box code sama.
7. Jika definition sudah direferensikan sedikitnya satu `packing_sessions` row, editor menjadi read-only. Tombol “Buat versi baru” meng-clone box, layer, dan requirement ke draft dengan version berikutnya.

## Architecture

- `src/app/admin/box-definitions`: route daftar dan editor box definition.
- `src/features/box-definitions`: query server, server actions, validation, types, dan client editor.
- Migration baru: RPC/action database yang terautorisasi admin untuk membuat, memperbarui draft, publish/activate, dan clone version. Semua perubahan menghasilkan audit log.
- Existing `private.validate_box_definition` dan `private.activate_box_definition` tetap menjadi sumber validasi/aktivasi database.

## Authorization and Integrity

- Semua halaman dan action memakai `requireAdmin()`.
- Browser hanya memakai Supabase client dengan RLS. Mutasi penting terjadi dalam RPC terautorisasi di private schema atau action server yang tidak mengekspos secret.
- Tidak ada edit destruktif pada versi yang telah digunakan oleh `packing_sessions`.
- Unique constraints existing tetap menjaga version, layer number/order, dan requirement product/order.
- RPC mengunci definition saat publish/activate atau clone untuk mencegah race condition.

## User Interface

- Sidebar admin mendapat menu “Box Definition”.
- Daftar menampilkan Master Item, box code/name, version, status draft/aktif, used, total layer, dan total quantity.
- Editor memakai Field/FieldGroup, Table, Card, Alert, Badge, Dialog/AlertDialog, dan Sonner shadcn existing.
- Reorder layer memakai aksi naik/turun agar keyboard-accessible dan tidak menambah dependency drag-and-drop.
- Versi used menampilkan alert dan semua mutation control disabled; action clone tetap tersedia.

## Error Handling

- Form menampilkan error field untuk input kosong, duplicate box/version, dan `expected_qty <= 0`.
- Publish menampilkan error domain dari validasi box tanpa database error mentah.
- Konflik activation atau clone menampilkan toast yang dapat dipahami admin dan data direfresh.

## Testing

- Unit test validation: trim input, positive quantity, layer/requirement validity, read-only eligibility.
- Integration/database test: admin-only mutation, invalid publish rejected, activation atomic, clone retains content and increments version, used definition mutation rejected.
- UI test: create draft, reorder layer, add requirement, total summary, publish, and clone control.

## Acceptance Mapping

| Task 4.6 item | Design coverage |
| --- | --- |
| Create box | Draft create action and editor |
| Add/reorder layers | Layer editor with persistent order |
| Add product requirements | Requirement editor restricted to mapped products |
| Validate expected_qty | Client/server/database positive integer checks |
| Total count summary | Per-layer and full-definition totals |
| Publish/activate | Database validation then atomic activation |
| New version flow | Clone into next-version draft |
| Read-only used versions | `packing_sessions` reference locks editing |

## Open Decisions

Tidak ada untuk Task 4.6. “Used” berarti definition memiliki minimal satu `packing_sessions` row.
