# Manajemen Delivery Number

`/admin/delivery-numbers` memfilter Delivery Number berdasarkan supplier dan status, lalu mendukung pembuatan, pengeditan data, serta penutupan atau pembatalan.

Status awal hanya `draft` atau `active`. Status `closed` dan `cancelled` bersifat terminal: data tidak dapat diedit atau diaktifkan kembali. Operator hanya dapat membaca Delivery Number `active` dari supplier yang juga aktif, sesuai kebijakan RLS.

Setiap mutasi dilakukan oleh RPC `SECURITY DEFINER` dengan pemeriksaan admin aktif dan append audit log. Nomor dinormalisasi menjadi huruf besar serta unik secara case-insensitive di dalam scope supplier.
