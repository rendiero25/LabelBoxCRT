/**
 * Kapan sebuah Box boleh disunting.
 *
 * Aturannya disalin dari predikat `private.box_has_ongoing_work` supaya layar
 * dan database tidak berbeda pendapat: checkbox yang hidup padahal RPC-nya
 * menolak hanya memindahkan penolakan itu ke tempat yang lebih membingungkan.
 *
 * Yang mengunci Box bukan "pernah dipakai", melainkan "masih ada pekerjaan
 * berjalan" — dan yang menyudahi pekerjaan adalah batch yang ditutup.
 */

/**
 * Sesi yang sudah selesai. Sesi hanya menjadi `confirmed` ketika print job-nya
 * selesai, jadi daftar ini saja tidak cukup: lihat `sessionsFromClosedBatch`.
 */
const finishedSessionStatuses = new Set(["confirmed", "cancelled", "expired"])

export type PackingSessionRow = { id: string; status: string }

export type LabelBoxRow = { batchId: string; packingSessionId: string | null }

export type BoxWorkInput = {
  sessions: PackingSessionRow[]
  labelBoxes: LabelBoxRow[]
  /** Ada batch milik Master Item pemilik Box ini yang belum ditutup. */
  hasOpenBatch: boolean
  /** Id batch yang sudah ditutup, milik Master Item mana pun. */
  closedBatchIds: ReadonlySet<string>
}

export type BoxWorkState = {
  /** Mengunci penyuntingan: produk, layer, dan penghapusan Box. */
  hasOngoingWork: boolean
  /** Hanya keterangan di layar; tidak mengunci apa pun. */
  hasHistory: boolean
}

export function boxWorkState({
  sessions,
  labelBoxes,
  hasOpenBatch,
  closedBatchIds,
}: BoxWorkInput): BoxWorkState {
  // Sesi yang lahir dari batch tertutup sudah selesai menurut orang yang
  // menutupnya, meski statusnya tertinggal di 'scanning' atau 'print_failed'.
  // Tanpa pengecualian ini, satu cetak yang gagal mengunci Box selamanya.
  const sessionsFromClosedBatch = new Set(
    labelBoxes
      .filter(
        (labelBox) =>
          labelBox.packingSessionId !== null &&
          closedBatchIds.has(labelBox.batchId),
      )
      .map((labelBox) => labelBox.packingSessionId),
  )

  const hasUnfinishedSession = sessions.some(
    (session) =>
      !finishedSessionStatuses.has(session.status) &&
      !sessionsFromClosedBatch.has(session.id),
  )

  return {
    hasOngoingWork: hasOpenBatch || hasUnfinishedSession,
    hasHistory: sessions.length > 0 || labelBoxes.length > 0,
  }
}
