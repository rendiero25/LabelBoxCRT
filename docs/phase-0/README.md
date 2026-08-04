# Phase 0 — Requirement Lock dan Hardware Discovery

Dokumen di folder ini adalah workbench resmi Phase 0. Status `terverifikasi`
hanya boleh diberikan bila ada bukti payload, persetujuan business owner, atau
hasil uji perangkat fisik. Proposal tidak boleh dipakai sebagai business
invariant sebelum disetujui.

## Status per 13 Juli 2026

| Area           | Status  | Gate yang belum terpenuhi                                                                                                                                                                                             |
| -------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QR contract    | Partial | Dua QR product telah didekode. Part No berasal dari Master Item/session untuk label box, bukan QR product. Field lot/reference dipakai sebagai `label_uid`. Unit per scan masih terbuka.                              |
| Business rules | Partial | Sumber field label, quantity layer, Qty default, urutan field, toast, dan font telah dikonfirmasi. Sequence scope, reference date mismatch, scan unit, cancel/reset, print confirmation, dan retention masih terbuka. |
| Hardware       | Partial | QZ Tray terpasang dan ZD220 dilaporkan menyala, tetapi printer Windows belum terdeteksi dan raw ZPL belum diuji. DS2208 masih dalam pengiriman.                                                                       |
| Branding       | Ready   | Logo resmi tersedia; palette dan contrast telah diekstrak; Outfit dipilih sebagai font aplikasi.                                                                                                                      |

## Artefak

- [QR contract](qr-contract.md)
- [Template sampel QR](qr-samples.csv)
- [Business decision register](business-rules.md)
- [Hardware discovery dan UAT](hardware-discovery.md)
- [Branding gate](branding.md)
- Repository target: <https://github.com/rendiero25/LabelBoxCRT.git>

## Exit criteria

Phase 0 dapat ditutup hanya setelah:

1. Minimal lima payload QR nyata telah di-review dan setiap label memiliki ID
   unik yang stabil.
2. Semua keputusan berstatus `PROPOSED` telah menjadi `APPROVED` dengan nama
   approver dan tanggal.
3. DS2208 lulus uji Notepad dan 100 scan; ZD220 lulus raw ZPL dengan media
   produksi; nama printer Windows dan dimensi media tercatat.
4. Strategi signing QZ untuk development dan production disetujui.
5. Logo resmi tersedia dan palette lolos pemeriksaan contrast.

## Evidence policy

- Jangan menyimpan screenshot yang mengandung secret, token, atau private key.
- Raw QR disimpan hanya di repository bila data tersebut dinyatakan non-sensitif.
  Jika sensitif, simpan versi redacted dan hash SHA-256 untuk referensi.
- Hasil hardware harus mencatat tanggal, operator penguji, workstation, device,
  driver/firmware bila tersedia, serta pass/fail.
