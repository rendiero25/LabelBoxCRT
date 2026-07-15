import { describe, expect, it } from "vitest"

import {
  getAuthNotice,
  getLoginReasonForAuthStatus,
  parseCredentials,
} from "@/features/auth/credentials"

describe("parseCredentials", () => {
  it("normalizes an email address and keeps the password unchanged", () => {
    expect(
      parseCredentials({
        email: " USER@CRTKABELITA.COM ",
        password: "S3cret Password",
      }),
    ).toEqual({
      credentials: {
        email: "user@crtkabelita.com",
        password: "S3cret Password",
      },
    })
  })

  it("rejects missing credentials without returning sensitive input", () => {
    expect(parseCredentials({ email: "", password: "" })).toEqual({
      error: "Email dan kata sandi wajib diisi.",
    })
  })
})

describe("getAuthNotice", () => {
  it("maps known auth states to safe operator messages", () => {
    expect(getAuthNotice("inactive")).toContain("tidak aktif")
    expect(getAuthNotice("session-expired")).toContain("berakhir")
    expect(getAuthNotice("signed-out")).toContain("keluar")
    expect(getAuthNotice("unauthorized")).toContain("masuk")
  })

  it("does not expose a notice for unknown reason values", () => {
    expect(getAuthNotice("unexpected-state")).toBeNull()
  })
})

describe("getLoginReasonForAuthStatus", () => {
  it("uses an expiry-safe reason for unverified sessions", () => {
    expect(getLoginReasonForAuthStatus("unauthenticated")).toBe(
      "session-expired",
    )
    expect(getLoginReasonForAuthStatus("inactive")).toBe("inactive")
    expect(getLoginReasonForAuthStatus("missing-profile")).toBe("unauthorized")
  })
})
