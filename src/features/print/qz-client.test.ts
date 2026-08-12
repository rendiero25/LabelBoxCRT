import { beforeEach, describe, expect, it, vi } from "vitest"

const qzMock = vi.hoisted(() => ({
  connect: vi.fn(),
  isActive: vi.fn(),
}))

vi.mock("qz-tray", () => ({
  default: {
    security: {
      setCertificatePromise: vi.fn(),
      setSignatureAlgorithm: vi.fn(),
      setSignaturePromise: vi.fn(),
    },
    websocket: {
      connect: qzMock.connect,
      isActive: qzMock.isActive,
    },
  },
}))

/** Modul menyimpan sambungan yang sedang berlangsung, jadi tiap tes butuh yang segar. */
async function freshClient() {
  vi.resetModules()
  return import("@/features/print/qz-client")
}

beforeEach(() => {
  qzMock.connect.mockReset()
  qzMock.isActive.mockReset()
})

describe("connectQz", () => {
  it("opens one socket when two components connect at the same time", async () => {
    // Halaman verifikasi memasang dua useQzConnection sekaligus. Saat panggilan
    // kedua tiba, socketnya masih dalam perjalanan dan isActive() masih false —
    // di sinilah dulu keduanya membuka sambungan sendiri-sendiri.
    qzMock.isActive.mockReturnValue(false)
    let settle = (): void => undefined
    qzMock.connect.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve
      }),
    )

    const { connectQz } = await freshClient()
    const first = connectQz()
    const second = connectQz()
    settle()
    await Promise.all([first, second])

    expect(qzMock.connect).toHaveBeenCalledTimes(1)
  })

  it("skips the socket entirely when one is already open", async () => {
    qzMock.isActive.mockReturnValue(true)

    const { connectQz } = await freshClient()
    await connectQz()

    expect(qzMock.connect).not.toHaveBeenCalled()
  })

  // Sambungan yang gagal tidak boleh mengunci percobaan berikutnya: hook
  // menjadwalkan ulang sendiri setelah 2 detik, dan percobaan itu harus benar
  // benar membuka socket lagi.
  it("lets the next attempt through after a failed one", async () => {
    qzMock.isActive.mockReturnValue(false)
    qzMock.connect
      .mockRejectedValueOnce(new Error("QZ Tray tidak berjalan"))
      .mockResolvedValueOnce(undefined)

    const { connectQz } = await freshClient()
    await expect(connectQz()).rejects.toThrow("QZ Tray tidak berjalan")
    await connectQz()

    expect(qzMock.connect).toHaveBeenCalledTimes(2)
  })
})
