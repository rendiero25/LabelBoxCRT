import { generateKeyPairSync } from "node:crypto"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}))

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }))

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
const privateKeyPem = privateKey
  .export({ format: "pem", type: "pkcs8" })
  .toString()

const { POST } = await import("@/app/api/qz/sign/route")

function supabaseStub() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { is_active: true } }),
        }),
      }),
    }),
  }
}

function signRequest(origin: string, host: string): NextRequest {
  return new NextRequest(`https://${host}/api/qz/sign`, {
    body: JSON.stringify({ request: "qz-call" }),
    headers: { "content-type": "application/json", host, origin },
    method: "POST",
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createClient.mockResolvedValue(supabaseStub())
  process.env.QZ_PRIVATE_KEY = privateKeyPem
  delete process.env.NEXT_PUBLIC_APP_URL
})

describe("POST /api/qz/sign", () => {
  /**
   * Tiap deployment preview Vercel punya host sendiri yang berganti tiap push,
   * jadi allowlist NEXT_PUBLIC_APP_URL tidak pernah mencakupnya. Ditolak di
   * sini, sambungan QZ tetap terlihat hijau tetapi daftar printernya kosong
   * dan operator tidak bisa memilih printer apa pun.
   */
  it("signs a request coming from the deployment's own origin", async () => {
    const response = await POST(
      signRequest(
        "https://label-box-crt-git-development.vercel.app",
        "label-box-crt-git-development.vercel.app",
      ),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      signature: expect.any(String),
    })
  })

  it("still signs a request from the configured app URL", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://labelbox.example.com/"

    const response = await POST(
      signRequest("https://labelbox.example.com", "internal-host"),
    )

    expect(response.status).toBe(200)
  })

  // Yang dijaga pemeriksaan origin adalah situs lain yang memakai sesi
  // pengguna untuk menandatangani perintah cetaknya sendiri.
  it("refuses an origin that is neither allowlisted nor the same host", async () => {
    const response = await POST(
      signRequest("https://jahat.example.com", "labelbox.vercel.app"),
    )

    expect(response.status).toBe(403)
  })

  it("refuses a request without an origin header", async () => {
    const request = new NextRequest("https://labelbox.vercel.app/api/qz/sign", {
      body: JSON.stringify({ request: "qz-call" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })

    expect((await POST(request)).status).toBe(403)
  })

  it("reports 503 when the private key is missing from the environment", async () => {
    delete process.env.QZ_PRIVATE_KEY

    const response = await POST(
      signRequest("https://labelbox.vercel.app", "labelbox.vercel.app"),
    )

    expect(response.status).toBe(503)
  })
})
