import { NextResponse } from "next/server"

export function GET() {
  const certificate = process.env.QZ_CERTIFICATE
  if (!certificate) {
    return NextResponse.json(
      { error: "Certificate not configured" },
      { status: 503 },
    )
  }

  return new NextResponse(certificate.replaceAll("\\n", "\n"), {
    headers: {
      "cache-control": "public, max-age=86400",
      "content-type": "text/plain; charset=utf-8",
    },
  })
}
