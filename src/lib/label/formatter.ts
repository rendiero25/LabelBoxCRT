/**
 * Data satu label box, diambil dari snapshot print_jobs ditambah nomor urut
 * Master Item milik batch. Urutan field mengikuti urutan barisnya di label.
 */
export type FinalizedLabelSnapshot = {
  supplierCode: string
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
  partNo: string
  packingQty: string
  qtyDelivery: string
  masterItemRowNo: string
  lotNo: string
  boxNumber: string
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

export function formatLabelFields(
  snapshot: FinalizedLabelSnapshot,
): FormattedLabelFields {
  return {
    supplierCode: snapshot.supplierCode,
    partNo: snapshot.partNo,
    packingQty: String(snapshot.packingQty),
    qtyDelivery: String(snapshot.qtyDelivery),
    masterItemRowNo: String(snapshot.masterItemRowNo),
    lotNo: snapshot.lotNo,
    boxNumber: snapshot.boxNumber,
    deliveryDate: formatShortDate(snapshot.deliveryDate),
    deliveryMonth: formatDeliveryMonth(snapshot.deliveryDate),
    qrPayload: snapshot.qrPayload,
  }
}
