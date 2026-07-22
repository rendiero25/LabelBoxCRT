import { createSign } from "node:crypto"

import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"

const MAX_PAYLOAD_BYTES = 4096
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 30

// In-memory sliding window per user. Single-instance internal tool; on
// serverless multi-instance deploys each instance rate-limits independently
// (accepted trade-off, spec §4).
const requestLog = new Map<string, number[]>()

function isRateLimited(userId: string): boolean {
  const now = Date.now()
  const recent = (requestLog.get(userId) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  )
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestLog.set(userId, recent)
    return true
  }
  recent.push(now)
  requestLog.set(userId, recent)
  return false
}

function allowedOrigins(): string[] {
  const origins = ["http://localhost:3000", "https://localhost:3000"]
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) origins.push(appUrl.replace(/\/$/, ""))
  return origins
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin")
  if (!origin || !allowedOrigins().includes(origin)) {
    console.warn("qz-sign: rejected origin", origin)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    console.warn("qz-sign: unauthenticated request")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (isRateLimited(user.id)) {
    console.warn("qz-sign: rate limited", user.id)
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const privateKey = process.env.QZ_PRIVATE_KEY
  if (!privateKey) {
    console.error("qz-sign: QZ_PRIVATE_KEY not configured")
    return NextResponse.json({ error: "Not configured" }, { status: 503 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  const message =
    payload && typeof payload === "object" && "request" in payload
      ? (payload as { request: unknown }).request
      : null
  if (typeof message !== "string" || message.length === 0) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }
  if (Buffer.byteLength(message, "utf8") > MAX_PAYLOAD_BYTES) {
    console.warn("qz-sign: payload too large", user.id)
    return NextResponse.json({ error: "Payload too large" }, { status: 413 })
  }

  const signer = createSign("RSA-SHA512")
  signer.update(message)
  const signature = signer.sign(privateKey.replaceAll("\\n", "\n"), "base64")

  return NextResponse.json({ signature })
}
