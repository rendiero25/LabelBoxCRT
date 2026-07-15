import { describe, expect, it } from "vitest"

import { getRoleHomePath, hasRequiredRole } from "@/features/auth/permissions"

describe("hasRequiredRole", () => {
  it("permits only the matching application role", () => {
    expect(hasRequiredRole("admin", "admin")).toBe(true)
    expect(hasRequiredRole("operator", "operator")).toBe(true)
    expect(hasRequiredRole("operator", "admin")).toBe(false)
    expect(hasRequiredRole("admin", "operator")).toBe(false)
  })
})

describe("getRoleHomePath", () => {
  it("routes each active role to its permitted application surface", () => {
    expect(getRoleHomePath("admin")).toBe("/admin")
    expect(getRoleHomePath("operator")).toBe("/scan")
  })
})
