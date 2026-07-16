import { describe, expect, it } from "vitest"

import { hashWorkstationDeviceToken } from "@/features/workstations/token"

describe("hashWorkstationDeviceToken", () => {
  it("creates a deterministic SHA-256 digest without retaining raw token", () => {
    expect(hashWorkstationDeviceToken("device-token")).toBe(
      "73fff793651a92729a8553521d5f1c55c9cb417046f1dc0f82b22fc4930b82b3",
    )
  })
})
