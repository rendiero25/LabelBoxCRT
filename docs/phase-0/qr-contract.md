# QR Contract v1 — Draft

Status: `PARTIAL — ONE REAL SAMPLE DECODED`

Satu QR nyata dari `docs/qr code.jpeg` berhasil didekode. Parser v1 tetap draft
sampai minimal lima payload produksi membuktikan struktur dan keunikan field.

## Sample QR-001

Raw payload, 76 karakter ASCII dan lima field pipe-delimited:

```text
10015|VO-B D5.5X6.3 Pt L=205|100|M-CRT-004A-778-131225-B002/P001|13-DEC-2025
```

| Posisi | Raw                               | Interpretasi terverifikasi          |
| ------ | --------------------------------- | ----------------------------------- |
| 1      | `10015`                           | Supplier code                       |
| 2      | `VO-B D5.5X6.3 Pt L=205`          | Size lengkap                        |
| 3      | `100`                             | Quantity pada label part            |
| 4      | `M-CRT-004A-778-131225-B002/P001` | Lot/reference yang diabaikan parser |
| 5      | `13-DEC-2025`                     | Production date pada label part     |

QR product memang **tidak memuat** Part No `3210A-K1Z-NA01-DL`. Part No tersebut
adalah data Master Item untuk label box yang akan dicetak. Operator memilih
Master Item/Part No dan Box aktif sebelum proses scan; parser QR tidak mencoba
menurunkan Part No dari payload product.

Field keempat (`M-CRT-.../P001`) tidak dibaca dan tidak digunakan sebagai
`label_uid`. Sampai sumber ID unik lain disepakati, duplicate prevention fisik
tetap deferred dan Phase 5 tidak boleh menggantinya dengan debounce waktu.

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
}
```

Field keempat di-skip setelah jumlah field dan format envelope divalidasi.
`partNo` berasal dari session/Master Item aktif. `labelUid` dan `unitsPerScan`
belum tersedia dan tidak boleh ditebak oleh client.

## Normalization proposal

| Field            | Aturan yang diusulkan                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payload          | Hapus hanya terminator CR/LF di akhir; jangan trim/mengubah isi lain sebelum parsing.                                                                          |
| `partNo`         | Trim, Unicode normalize NFKC, uppercase, pertahankan delimiter seperti `-`.                                                                                    |
| `size`           | Trim, Unicode normalize NFKC, collapse whitespace internal menjadi satu spasi; case-fold hanya untuk lookup normalized.                                        |
| Komponen Size    | Parse ketat pola `D{dimension1}X{dimension2} ... L={length}`; input admin menyimpan angka `5.5`, `6.3`, dan `205`, lalu format display dibentuk deterministik. |
| `productionDate` | Parse strict `DD-MMM-YYYY` berbahasa Inggris dari QR, lalu simpan sebagai PostgreSQL `date`.                                                                   |
| Angka            | Gunakan format ASCII yang didefinisikan kontrak; jangan menerka locale.                                                                                        |

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

1. Field apa yang menyediakan `label_uid` unik, karena lot/reference diabaikan?
2. Apakah satu scan menghitung satu label/pack atau 100 unit yang tercetak pada
   QR?
