# Manajemen Supplier

Halaman `/admin/suppliers` hanya dapat dibuka admin aktif dan menyediakan pencarian, filter status, buat, edit, aktivasi, dan nonaktif supplier.

Setiap mutasi dilakukan melalui RPC `SECURITY DEFINER` yang memverifikasi `private.is_active_admin()` dan menulis audit log. Kode supplier dinormalisasi menjadi huruf besar serta unik secara case-insensitive.

Supplier tidak memiliki aksi hapus. `delivery_numbers.supplier_id` memakai `ON DELETE RESTRICT`, sehingga riwayat Delivery Number tidak dapat terputus. Admin menonaktifkan supplier untuk menghentikan pemakaian baru dan dapat mengaktifkannya kembali bila diperlukan.
