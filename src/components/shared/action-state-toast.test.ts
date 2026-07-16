import { describe, expect, it } from "vitest"

import { actionStateToast } from "@/components/shared/action-state-toast"

describe("actionStateToast", () => {
  it("uses an error message before a success message", () => {
    expect(
      actionStateToast({
        error: "Data tidak dapat disimpan.",
        success: "Data tersimpan.",
      }),
    ).toEqual({ type: "error", message: "Data tidak dapat disimpan." })
  })

  it("returns a success toast for a completed action", () => {
    expect(actionStateToast({ success: "Data tersimpan." })).toEqual({
      type: "success",
      message: "Data tersimpan.",
    })
  })

  it("does not create a toast before an action returns a message", () => {
    expect(actionStateToast({})).toBeNull()
  })
})
