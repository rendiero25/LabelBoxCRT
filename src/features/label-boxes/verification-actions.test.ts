import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn((path: string) => {
    // next/navigation melempar untuk menghentikan aksinya; tiruannya harus
    // melakukan hal yang sama, kalau tidak kode sesudah redirect ikut jalan.
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }))
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }))

const { closeLabelBoxBatchAction } =
  await import("@/features/label-boxes/verification-actions")

const batchId = "c61b11fd-de21-4ab2-8fff-41049f25c285"

function formDataFor(id: string): FormData {
  const formData = new FormData()
  formData.set("batchId", id)
  return formData
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc })
})

/**
 * Menutup verifikasi menghapus halaman yang sedang dibuka: batch dengan
 * closed_at terisi tidak lagi punya halaman verifikasi, jadi route itu berubah
 * jadi notFound(). Perpindahan harus datang dari aksinya sendiri; yang
 * dijalankan belakangan dari klien berlomba dengan penyegaran route dan
 * meninggalkan operator di halaman "tidak ditemukan".
 */
describe("closeLabelBoxBatchAction", () => {
  it("redirects to the label box list with the closing summary", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ label_count: 3, verified_count: 3 }],
      error: null,
    })

    await expect(
      closeLabelBoxBatchAction({}, formDataFor(batchId)),
    ).rejects.toThrow("NEXT_REDIRECT:/scan?verifikasi=3-3")

    expect(mocks.revalidatePath).toHaveBeenCalledWith("/scan")
  })

  it("keeps the operator on the page when the RPC refuses", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "LABEL_BOX_SETS_INCOMPLETE" },
    })

    const state = await closeLabelBoxBatchAction({}, formDataFor(batchId))

    expect(state.error).toContain("belum penuh")
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it("refuses a batch id that is not a uuid without calling the RPC", async () => {
    const state = await closeLabelBoxBatchAction({}, formDataFor("bukan-uuid"))

    expect(state).toEqual({ error: "Batch tidak valid." })
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})
