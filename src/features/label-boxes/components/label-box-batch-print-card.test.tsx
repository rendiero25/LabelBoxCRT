// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { LabelBoxPrintJob } from "@/features/label-boxes/verification-form-state"

const mocks = vi.hoisted(() => ({
  claimPrintJobAction: vi.fn(),
  completePrintJobAction: vi.fn(),
  createLabelBoxPrintJobsAction: vi.fn(),
  createLabelBoxReprintJobsAction: vi.fn(),
  qz: {
    printerError: null as string | null,
    printers: ["ZDesigner ZD220-203dpi ZPL"] as string[],
  },
  refreshPrinters: vi.fn(),
  sendHtmlSheets: vi.fn(),
  sendZplBatch: vi.fn(),
}))

vi.mock("@/features/print/actions", () => ({
  claimPrintJobAction: mocks.claimPrintJobAction,
  completePrintJobAction: mocks.completePrintJobAction,
}))

vi.mock("@/features/label-boxes/verification-actions", () => ({
  createLabelBoxPrintJobsAction: mocks.createLabelBoxPrintJobsAction,
  createLabelBoxReprintJobsAction: mocks.createLabelBoxReprintJobsAction,
}))

vi.mock("@/features/print/qz-client", () => ({
  sendHtmlSheets: mocks.sendHtmlSheets,
  sendZplBatch: mocks.sendZplBatch,
}))

vi.mock("@/features/print/label-font-loader", () => ({
  loadLabelFontUploads: async () => [],
}))

vi.mock("@/features/print/use-qz-connection", () => ({
  useQzConnection: () => ({
    connect: vi.fn(),
    printerError: mocks.qz.printerError,
    printers: mocks.qz.printers,
    refreshPrinters: mocks.refreshPrinters,
    refreshScanner: vi.fn(),
    scanner: null,
    status: "connected",
  }),
}))

vi.mock("@/features/print/components/use-preferred-printer", () => ({
  setPreferredPrinter: vi.fn(),
  usePreferredPrinter: () => "ZDesigner ZD220-203dpi ZPL",
}))

vi.mock("qrcode", () => ({
  default: { toDataURL: async () => "data:image/png;base64,QQ==" },
}))

const { LabelBoxBatchPrintCard } =
  await import("@/features/label-boxes/components/label-box-batch-print-card")

function jobFixture(index: number): LabelBoxPrintJob {
  return {
    boxName: `Box ${index}`,
    boxNumber: `B${index}01`,
    deliveryDate: "2026-08-26",
    deliveryNumber: "DN-08-2026-12599",
    labelBoxId: `1de1b0x0-0000-0000-0000-00000000000${index}`,
    labelReference: `11${index}-260826-B${index}01`,
    lotNo: "CRT082805",
    masterItemRowNo: 1,
    packingDate: "2026-08-12",
    partName: "Tube Assy",
    partNo: "3210A-K1Z-NA01-DL",
    printJobId: `10b1e5e5-0000-0000-0000-00000000000${index}`,
    qrPayload: "10015|3210A-K1Z-NA01-DL|100|1-CRT082805-B101|26-AUG-2026",
    qty: 100,
    qtyDelivery: 5000,
    status: "pending",
    supplierCode: "10015",
    supplierName: "PT Cipta Mandiri Wirasakti",
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  mocks.qz.printerError = null
  mocks.qz.printers = ["ZDesigner ZD220-203dpi ZPL"]
  mocks.createLabelBoxPrintJobsAction.mockResolvedValue({
    jobs: [jobFixture(1), jobFixture(2), jobFixture(3)],
  })
  mocks.completePrintJobAction.mockResolvedValue({})
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function renderAndPrint(): Promise<void> {
  await act(async () => {
    root.render(
      <LabelBoxBatchPrintCard batchId="c61b11fd-0000-4000-8000-000000000001" />,
    )
  })

  const button = [...container.querySelectorAll("button")].find((element) =>
    element.textContent?.includes("Cetak"),
  )
  await act(async () => {
    button?.click()
  })
}

/**
 * Klaim mengubah status job jadi 'printing', dan job 'printing' baru boleh
 * diklaim ulang setelah dua menit. Berhenti di tengah tanpa melepas yang sudah
 * diklaim membuat percobaan berikutnya ditolak PRINT_JOB_NOT_CLAIMABLE — cetak
 * pertama gagal, cetak kedua mustahil.
 */
describe("LabelBoxBatchPrintCard", () => {
  it("releases jobs it already claimed when a later claim is refused", async () => {
    mocks.claimPrintJobAction
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ error: "Print job ini sedang dicetak." })

    await renderAndPrint()

    const released = mocks.completePrintJobAction.mock.calls.map(
      ([input]) => input,
    )
    expect(released).toHaveLength(1)
    expect(released[0]).toMatchObject({
      printJobId: jobFixture(1).printJobId,
      result: "failed",
    })
  })

  it("releases every claim when the printer refuses the batch", async () => {
    mocks.claimPrintJobAction.mockResolvedValue({})
    mocks.sendZplBatch.mockRejectedValue(new Error("printer mati"))

    await renderAndPrint()

    const released = mocks.completePrintJobAction.mock.calls.map(
      ([input]) => input,
    )
    expect(released).toHaveLength(3)
    for (const call of released) {
      expect(call).toMatchObject({
        errorCode: "QZ_SEND_FAILED",
        result: "failed",
      })
    }
  })

  /**
   * Preview memakai jalur rakit yang sama dengan cetak kertas. Kalau ia diam
   * saat job sudah siap, operator kembali menekan Cetak tanpa pernah melihat
   * lot, tanggal, dan nomor box yang akan tercetak.
   */
  it("shows a preview of the first label once the jobs are ready", async () => {
    await act(async () => {
      root.render(
        <LabelBoxBatchPrintCard batchId="c61b11fd-0000-4000-8000-000000000001" />,
      )
    })

    expect(container.textContent).toContain("Preview label")
    expect(container.textContent).toContain(jobFixture(1).boxNumber)
    expect(container.querySelector("img[src^='data:image/png']")).not.toBeNull()
    expect(container.textContent).toContain(jobFixture(1).lotNo)
  })

  /**
   * Sambungan QZ bisa hijau sementara tiap panggilan bertanda tangan ditolak —
   * itu yang terjadi di Vercel ketika /api/qz/sign menolak origin deployment.
   * Daftar printernya kosong, dan layar yang cuma bilang "pilih printer dulu"
   * mengirim operator menekan daftar kosong berulang kali.
   */
  it("names the reason the printer list is empty and offers a retry", async () => {
    mocks.qz.printers = []
    mocks.qz.printerError = "QZ signing failed (403)"

    await act(async () => {
      root.render(
        <LabelBoxBatchPrintCard batchId="c61b11fd-0000-4000-8000-000000000001" />,
      )
    })

    expect(container.textContent).toContain("QZ signing failed (403)")
    expect(container.textContent).not.toContain("Pilih printer dulu")

    const retry = [...container.querySelectorAll("button")].find((element) =>
      element.textContent?.includes("Muat ulang daftar printer"),
    )
    await act(async () => {
      retry?.click()
    })
    expect(mocks.refreshPrinters).toHaveBeenCalledTimes(1)
  })

  it("leaves nothing claimed when every label prints", async () => {
    mocks.claimPrintJobAction.mockResolvedValue({})
    mocks.sendZplBatch.mockResolvedValue(undefined)

    await renderAndPrint()

    const results = mocks.completePrintJobAction.mock.calls.map(
      ([input]) => input.result,
    )
    expect(results).toEqual(["sent", "sent", "sent"])
  })
})
