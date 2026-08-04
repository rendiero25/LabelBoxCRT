# QR Contract v1 — Draft

Status: `PARTIAL — TWO REAL SAMPLES DECODED`

Dua QR nyata berhasil didekode. Parser v1 tetap draft sampai minimal lima
payload produksi membuktikan struktur dan keunikan field.

## Sample QR-001

Raw payload, 76 karakter ASCII dan lima field pipe-delimited:

```text
10015|VO-B D5.5X6.3 Pt L=205|100|M-CRT-004A-778-131225-B002/P001|13-DEC-2025
```

| Posisi | Raw                               | Interpretasi terverifikasi                 |
| ------ | --------------------------------- | ------------------------------------------ |
| 1      | `10015`                           | Supplier code                              |
| 2      | `VO-B D5.5X6.3 Pt L=205`          | Size lengkap                               |
| 3      | `100`                             | Quantity pada label part                   |
| 4      | `M-CRT-004A-778-131225-B002/P001` | Lot/reference, dipakai sebagai `label_uid` |
| 5      | `13-DEC-2025`                     | Production date pada label part            |

## Sample QR-002

Dipindai dari scanner produksi pada 31 Juli 2026:

```text
10015|VO-B D6X7 Pt.L=525|100|M-CRT-004A-675-300726-B001/P0001|30-Jul-2026
```

Dua perbedaan bentuk terhadap QR-001, keduanya sah dan harus diterima parser:

| Bagian       | QR-001             | QR-002             |
| ------------ | ------------------ | ------------------ |
| Sebelum `L=` | spasi (`Pt L=205`) | titik (`Pt.L=525`) |
| Bulan        | `DEC`              | `Jul`              |

QR product memang **tidak memuat** Part No `3210A-K1Z-NA01-DL`. Part No tersebut
adalah data Master Item untuk label box yang akan dicetak. Operator memilih
Master Item/Part No dan Box aktif sebelum proses scan; parser QR tidak mencoba
menurunkan Part No dari payload product.

Field keempat (`M-CRT-.../P001`) dipakai sebagai `label_uid`. Sufiks `/P####`
adalah nomor label di dalam lot, satu-satunya bagian payload yang berbeda antar
label fisik, sehingga duplicate prevention memakai nilai ini (trim + NFKC +
uppercase) dan bukan debounce waktu. Keunikannya masih bertumpu pada dua
sample; bila sample berikut menunjukkan sufiks berulang antar lot, keputusan ini
harus ditinjau ulang.

## Input envelope yang diusulkan

- Input berasal dari Zebra DS2208 dalam mode USB HID Keyboard.
- Enter/Carriage Return adalah terminator dan bukan bagian payload.
- Panjang maksimum defensif awal: 2.048 karakter UTF-8. Nilai ini bukan panjang
  payload aktual (sample pertama 76 karakter) dan harus diturunkan setelah
  seluruh sample tersedia.
  bukan bukti panjang payload aktual, dan harus diturunkan bila sample nyata
  menunjukkan batas yang lebih kecil.
- Tolak NUL dan control character selain separator yang secara eksplisit
  disetujui dalam kontrak QR.
- Jangan log raw payload pada log operasi normal.

## Output parser minimum

```ts
type ParsedBarcodeV1Draft = {
  parserVersion: "v1"
  supplierCode: string
  sizeRaw: string
  size: {
    dimension1: number // 5.5
    dimension2: number // 6.3
    length: number // 205
  }
  labelQuantity: number // 100
  productionDate: string // ISO date after strict parsing
  labelUid: string // field keempat, trim + NFKC + uppercase
}
```

`partNo` berasal dari session/Master Item aktif. `unitsPerScan` belum tersedia
dan tidak boleh ditebak oleh client.

## Normalization proposal

| Field            | Aturan yang diusulkan                                                                                                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payload          | Hapus hanya terminator CR/LF di akhir; jangan trim/mengubah isi lain sebelum parsing.                                                                                                                                                     |
| `partNo`         | Trim, Unicode normalize NFKC, uppercase, pertahankan delimiter seperti `-`.                                                                                                                                                               |
| `size`           | Trim, Unicode normalize NFKC, collapse whitespace internal menjadi satu spasi; case-fold hanya untuk lookup normalized.                                                                                                                   |
| Komponen Size    | Parse ketat pola `D{dimension1}X{dimension2} ... L={length}`, case-insensitive; pemisah sebelum `L=` boleh spasi atau titik; input admin menyimpan angka `5.5`, `6.3`, dan `205`, lalu format display dibentuk deterministik.             |
| `productionDate` | Parse strict `DD-MMM-YYYY` berbahasa Inggris dari QR, nama bulan case-insensitive, lalu simpan sebagai PostgreSQL `date`.                                                                                                                 |
| `labelUid`       | Trim, Unicode normalize NFKC, uppercase; delimiter `-` dan `/` dipertahankan. Uppercase wajib karena duplicate prevention membandingkan nilai ini apa adanya, sedangkan Caps Lock workstation membalik besar-kecil huruf kiriman scanner. |
| Angka            | Gunakan format ASCII yang didefinisikan kontrak; jangan menerka locale.                                                                                                                                                                   |

Raw value dan normalized value harus dapat dibedakan pada diagnostic yang hanya
dapat diakses role berizin. Keputusan duplicate selalu memakai identitas unik
yang stabil, bukan debounce waktu.

## Sample review

Isi [qr-samples.csv](qr-samples.csv) dengan minimal lima sample. Untuk setiap
baris, review harus membuktikan expected output dan alasan pass/fail. Sample
yang wajib dicakup:

1. Dua label berbeda untuk Size yang sama untuk membuktikan struktur stabil.
2. Label yang sama dipindai dua kali.
3. Part No berbeda.
4. Size berbeda.
5. Payload malformed atau field wajib hilang.

## Approval

| Peran                  | Nama | Tanggal | Status  |
| ---------------------- | ---- | ------- | ------- |
| Process/business owner | —    | —       | Pending |
| IT/integration owner   | —    | —       | Pending |
| Developer              | —    | —       | Pending |

## Open contract decisions

1. Apakah satu scan menghitung satu label/pack atau 100 unit yang tercetak pada
   QR?

## Closed contract decisions

1. Sumber `label_uid` (31 Juli 2026): field keempat penuh, termasuk sufiks
   `/P####`. Sebelumnya field ini diabaikan, sehingga setiap scan ditolak
   `LABEL_UID_MISSING` dan tidak pernah tercatat.
