import { describe, expect, it } from "vitest"

import { getPublicSupabaseEnv } from "@/lib/env/public"

describe("getPublicSupabaseEnv", () => {
  it("rejects missing public Supabase configuration", () => {
    expect(() => getPublicSupabaseEnv({})).toThrowError(
      "Supabase public environment is not configured",
    )
  })

  it("returns validated public Supabase configuration", () => {
    expect(
      getPublicSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      }),
    ).toEqual({
      url: "https://example.supabase.co",
      publishableKey: "sb_publishable_test",
    })
  })
})
