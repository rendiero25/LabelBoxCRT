// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  connectQz: vi.fn(async () => undefined),
  listPrinters: vi.fn(async () => ["Canon G4010 series", "Microsoft PDF"]),
  listUsbDevices: vi.fn(async () => []),
  onQzClosed: vi.fn(() => () => undefined),
}))

vi.mock("@/features/print/qz-client", () => mocks)
vi.mock("@/features/scan/zebra-scanner", () => ({
  findZebraScanner: () => null,
}))

const { resetQzConnectionForTests, useQzConnection } =
  await import("@/features/print/use-qz-connection")

function Probe({ label }: { label: string }) {
  const { printerError, printers, status } = useQzConnection()
  return (
    <span
      id={label}
    >{`${status}|${printers.join(",")}|${printerError ?? ""}`}</span>
  )
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  resetQzConnectionForTests()
  vi.clearAllMocks()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("useQzConnection", () => {
  /**
   * Panel status di header dan kartu cetak hidup berdampingan di halaman
   * verifikasi. Ketika masing-masing menyimpan daftarnya sendiri, kartu bisa
   * berakhir dengan daftar kosong sementara header penuh — dan tombol Cetak
   * mati dengan alasan "pilih printer dulu" walau printernya sudah dipilih.
   */
  it("gives every consumer the same printers from one lookup", async () => {
    await act(async () => {
      root.render(
        <>
          <Probe label="header" />
          <Probe label="card" />
        </>,
      )
    })

    const header = container.querySelector("#header")?.textContent
    const card = container.querySelector("#card")?.textContent

    expect(header).toBe("connected|Canon G4010 series,Microsoft PDF|")
    expect(card).toBe(header)
    expect(mocks.connectQz).toHaveBeenCalledTimes(1)
    expect(mocks.listPrinters).toHaveBeenCalledTimes(1)
  })

  it("keeps both consumers on the same status when the connection fails", async () => {
    mocks.connectQz.mockRejectedValueOnce(new Error("QZ Tray tidak berjalan"))

    await act(async () => {
      root.render(
        <>
          <Probe label="header" />
          <Probe label="card" />
        </>,
      )
    })

    expect(container.querySelector("#header")?.textContent).toBe("error||")
    expect(container.querySelector("#card")?.textContent).toBe("error||")
  })

  /**
   * Sambungan QZ hijau tidak menjamin panggilannya diterima: daftar printer
   * dibaca lewat panggilan bertanda tangan, dan penolakan tanda tangan dulu
   * ditelan jadi daftar kosong tanpa sebab. Yang terlihat operator hanyalah
   * daftar printer yang tidak bisa dipilih.
   */
  it("keeps the reason when the printer lookup is refused", async () => {
    mocks.listPrinters.mockRejectedValueOnce(
      new Error("QZ signing failed (403)"),
    )

    await act(async () => {
      root.render(<Probe label="card" />)
    })

    expect(container.querySelector("#card")?.textContent).toBe(
      "connected||QZ signing failed (403)",
    )
  })
})
