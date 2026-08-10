/**
 * Data satu label box, diambil dari snapshot print_jobs ditambah nomor urut
 * Master Item milik batch. Urutan field mengikuti urutan barisnya di label.
 */
export type FinalizedLabelSnapshot = {
  supplierCode: string
  supplierName: string
  partNo: string
  packingQty: number
  qtyDelivery: number
  masterItemRowNo: number
  lotNo: string
  boxNumber: string
  deliveryDate: string
  /** QR payload yang sudah dirakit dan disimpan di label_boxes.qr_payload. */
  qrPayload: string
}

export type FormattedLabelFields = {
  supplierCode: string
  /** Nama supplier, dicetak di baris Customer di bawah Supplier ID. */
  supplierName: string
  partNo: string
  packingQty: string
  qtyDelivery: string
  /**
   * Tiga penanda kiriman dirangkai jadi satu baris: nomor urut Master Item dua
   * digit, Lot No dari form, lalu nomor box. Ketiganya dulu berdiri sendiri
   * ("Item List", "Lot No", "No Box") dan menghabiskan tiga baris label.
   */
  lotNo: string
  deliveryDate: string
  /** Bulan kirim tanpa angka nol di depan, dicetak besar sebagai penanda FIFO. */
  deliveryMonth: string
  qrPayload: string
}

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})/

/**
 * Tanggal ringkas DD-MM-YYYY. Dipakai label box, QR payload, dan kolom tanggal
 * di tabel batch label box, jadi ketiganya selalu terbaca sama oleh operator.
 */
export function formatShortDate(isoTimestamp: string): string {
  const match = isoDatePattern.exec(isoTimestamp)
  if (!match) {
    throw new Error(
      `formatShortDate: expected an ISO timestamp (YYYY-MM-DD...), received "${isoTimestamp}"`,
    )
  }

  const [, yearText, monthText, dayText] = match
  return `${dayText}-${monthText}-${yearText}`
}

/**
 * Bulan saja, diambil dari tanggal kirim yang sama dengan baris Delivery Date,
 * supaya angka besar di label tidak pernah berbeda dari tanggalnya. Nol di
 * depan dibuang: yang dibaca dari jauh angkanya, bukan lebar dua digitnya.
 */
export function formatDeliveryMonth(isoTimestamp: string): string {
  const match = isoDatePattern.exec(isoTimestamp)
  if (!match) {
    throw new Error(
      `formatDeliveryMonth: expected an ISO timestamp (YYYY-MM-DD...), received "${isoTimestamp}"`,
    )
  }

  return String(Number(match[2]))
}

/**
 * Baris Lot No pada label: nomor urut Master Item, Lot No, dan nomor box dalam
 * satu baris. Nomor urut dicetak dua digit supaya lebarnya tetap dan operator
 * membaca ketiga bagiannya di posisi yang sama pada setiap label; nomor di atas
 * 99 dibiarkan apa adanya, memotongnya akan menunjuk item yang salah.
 */
export function formatLotNoLine(snapshot: FinalizedLabelSnapshot): string {
  const rowNo = String(snapshot.masterItemRowNo).padStart(2, "0")
  return `${rowNo}-${text(snapshot.lotNo)}-${text(snapshot.boxNumber)}`
}

/**
 * Nilai snapshot datang dari RPC, dan kolom yang belum ada atau bernilai null
 * di sana sampai ke sini sebagai undefined. Satu field kosong hanya boleh
 * membuat barisnya kosong; tanpa ini seluruh lembar cetak gagal dirender.
 */
function text(value: string | null | undefined): string {
  return value ?? ""
}

/**
 * Kedua baris jumlah bersatuan. Qty/Box dan Qty/Delivery berdampingan di label
 * dan angkanya sering berbeda; salah satu bersatuan dan satunya tidak akan
 * terbaca seolah keduanya menghitung hal yang berbeda jenis.
 */
function withUnit(qty: number): string {
  return `${qty} pcs`
}

export function formatLabelFields(
  snapshot: FinalizedLabelSnapshot,
): FormattedLabelFields {
  return {
    supplierCode: text(snapshot.supplierCode),
    supplierName: text(snapshot.supplierName),
    partNo: text(snapshot.partNo),
    packingQty: withUnit(snapshot.packingQty),
    qtyDelivery: withUnit(snapshot.qtyDelivery),
    lotNo: formatLotNoLine(snapshot),
    deliveryDate: formatShortDate(snapshot.deliveryDate),
    deliveryMonth: formatDeliveryMonth(snapshot.deliveryDate),
    qrPayload: text(snapshot.qrPayload),
  }
}
