// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { DeliverySession } from "@/features/delivery-verification/form-state"

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  verifyDeliveryLabelAction: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}))

vi.mock("@/features/delivery-verification/actions", () => ({
  createDeliverySessionAction: vi.fn(),
  deleteDeliverySessionAction: vi.fn(),
  deleteScheduleRowAction: vi.fn(),
  uploadScheduleFileAction: vi.fn(),
  verifyDeliveryLabelAction: mocks.verifyDeliveryLabelAction,
}))

const { DeliverySessionWorkspace } =
  await import("@/features/delivery-verification/components/delivery-session-workspace")

function sessionFixture(
  overrides: Partial<DeliverySession> = {},
): DeliverySession {
  return {
    createdAt: "2026-08-24T10:00:00.000Z",
    id: "8e2a0000-0000-0000-0000-000000000001",
    rows: [
      {
        id: "8e2b0000-0000-0000-0000-000000000001",
        productSize: "VDX T0.3XW100 L=120MM",
        qty: 5000,
        rowNo: 1,
        sourceFileName: "jadwal.xlsx",
        verifiedAt: null,
      },
    ],
    sessionNo: 1,
    status: "open",
    ...overrides,
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(sessions: DeliverySession[]) {
  act(() => {
    root.render(<DeliverySessionWorkspace sessions={sessions} />)
  })
}

// Penanda baris jadwal yang cuma muncul di dalam tabel yang terlipat --
// "Schedule Delivery" sendiri tidak dipakai karena kalimat pembuka halaman
// juga menyebutnya, membuat pengecekan substring itu selalu lolos.
const ROW_MARKER = "VDX T0.3XW100 L=120MM"

/**
 * verify_delivery_label menutup session (status -> 'done') di RPC yang sama
 * dengan scan yang melunasi baris terakhirnya, dan halaman mengambil status
 * baru itu lewat router.refresh() -- props baru pada komponen yang sama, bukan
 * remount. Testnya meniru urutan itu persis: render sesi yang open, lalu
 * render ulang root yang sama dengan sesi yang sudah done.
 */
describe("DeliverySessionWorkspace", () => {
  it("keeps a session open when its own last scan completes it", () => {
    render([sessionFixture()])
    expect(container.textContent).toContain(ROW_MARKER)

    render([
      sessionFixture({
        rows: [
          {
            ...sessionFixture().rows[0],
            verifiedAt: "2026-08-24T10:05:00.000Z",
          },
        ],
        status: "done",
      }),
    ])

    expect(container.textContent).toContain(ROW_MARKER)
  })

  it("still starts collapsed for a session that was already done on first load", () => {
    render([
      sessionFixture({
        rows: [
          {
            ...sessionFixture().rows[0],
            verifiedAt: "2026-08-24T10:05:00.000Z",
          },
        ],
        status: "done",
      }),
    ])

    expect(container.textContent).not.toContain(ROW_MARKER)
  })

  /**
   * scanner-listener.ts sudah menangkap onScan yang menolak, tapi diam-diam:
   * ia hanya memperbarui state internal, tidak pernah menampilkan toast.
   * Sebelum penangkapan ini ditambahkan, kegagalan seperti jaringan putus atau
   * server action yang tidak sinkron dengan build browser membisu -- operator
   * mengira scannya tidak terbaca sama sekali.
   */
  it("surfaces an unexpected scan failure instead of staying silent", async () => {
    mocks.verifyDeliveryLabelAction.mockRejectedValueOnce(
      new Error("network gagal"),
    )

    render([sessionFixture()])

    const startButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Mulai scan"),
    )
    await act(async () => {
      startButton?.click()
    })

    await act(async () => {
      for (const character of "10015|VDX|5000|1-LOT-A-B101|24-AUG-2026") {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: character }))
      }
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
      // Menembus queue promise scanner-listener + await di handleScan sendiri;
      // macrotask memastikan seluruh microtask di antaranya sudah selesai.
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(mocks.toastError).toHaveBeenCalledWith(
      expect.stringContaining("kesalahan tak terduga"),
    )
    // Kegagalan tak terduga bukan alasan mematikan scanner: operator masih
    // perlu menembak ulang label yang sama begitu tahu apa yang terjadi.
    expect(
      [...container.querySelectorAll("button")].some((button) =>
        button.textContent?.includes("Scan aktif"),
      ),
    ).toBe(true)
  })
})
