import { describe, expect, it } from "vitest"

import { boxWorkState } from "@/features/master-items/box-lock"

const noBatches = { hasOpenBatch: false, closedBatchIds: new Set<string>() }

describe("boxWorkState", () => {
  it("leaves a box that was never used fully open", () => {
    expect(
      boxWorkState({ sessions: [], labelBoxes: [], ...noBatches }),
    ).toEqual({ hasOngoingWork: false, hasHistory: false })
  })

  it("opens a box whose sessions are all confirmed", () => {
    expect(
      boxWorkState({
        sessions: [
          { id: "session-1", status: "confirmed" },
          { id: "session-2", status: "confirmed" },
        ],
        labelBoxes: [{ batchId: "batch-1", packingSessionId: "session-1" }],
        hasOpenBatch: false,
        closedBatchIds: new Set(["batch-1"]),
      }),
    ).toEqual({ hasOngoingWork: false, hasHistory: true })
  })

  it("locks a box while any batch of its master item is open", () => {
    expect(
      boxWorkState({
        sessions: [{ id: "session-1", status: "confirmed" }],
        labelBoxes: [{ batchId: "batch-1", packingSessionId: "session-1" }],
        hasOpenBatch: true,
        closedBatchIds: new Set(["batch-1"]),
      }).hasOngoingWork,
    ).toBe(true)
  })

  it("locks a box whose session is still being scanned", () => {
    expect(
      boxWorkState({
        sessions: [{ id: "session-1", status: "scanning" }],
        labelBoxes: [],
        ...noBatches,
      }).hasOngoingWork,
    ).toBe(true)
  })

  /**
   * Sesi hanya menjadi 'confirmed' ketika print job-nya selesai, dan
   * close_label_box_batch justru membuat sesi 'scanning' untuk box yang tidak
   * pernah discan. Tanpa pengecualian ini, satu cetak yang gagal mengunci Box
   * selamanya.
   */
  it("releases an unfinished session that belongs to a closed batch", () => {
    expect(
      boxWorkState({
        sessions: [
          { id: "session-1", status: "print_failed" },
          { id: "session-2", status: "scanning" },
        ],
        labelBoxes: [
          { batchId: "batch-1", packingSessionId: "session-1" },
          { batchId: "batch-1", packingSessionId: "session-2" },
        ],
        hasOpenBatch: false,
        closedBatchIds: new Set(["batch-1"]),
      }),
    ).toEqual({ hasOngoingWork: false, hasHistory: true })
  })

  it("keeps locking an unfinished session that no closed batch claims", () => {
    expect(
      boxWorkState({
        sessions: [{ id: "session-1", status: "print_failed" }],
        labelBoxes: [{ batchId: "batch-1", packingSessionId: "session-2" }],
        hasOpenBatch: false,
        closedBatchIds: new Set(["batch-1"]),
      }).hasOngoingWork,
    ).toBe(true)
  })

  it("reports history from label boxes even without a session", () => {
    expect(
      boxWorkState({
        sessions: [],
        labelBoxes: [{ batchId: "batch-1", packingSessionId: null }],
        hasOpenBatch: false,
        closedBatchIds: new Set(["batch-1"]),
      }),
    ).toEqual({ hasOngoingWork: false, hasHistory: true })
  })
})
