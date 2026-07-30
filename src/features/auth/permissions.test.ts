import { describe, expect, it } from "vitest"

import { getRoleHomePath, isAdminRole } from "@/features/auth/permissions"

describe("isAdminRole", () => {
  it("admits only the admin role", () => {
    expect(isAdminRole("admin")).toBe(true)
    expect(isAdminRole("user")).toBe(false)
  })
})

describe("getRoleHomePath", () => {
  it("routes each active role to its permitted application surface", () => {
    expect(getRoleHomePath("admin")).toBe("/admin")
    expect(getRoleHomePath("user")).toBe("/scan")
  })
})
