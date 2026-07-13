import { createBrowserClient } from "@supabase/ssr"

import { getPublicSupabaseEnv } from "@/lib/env/public"
import type { Database } from "@/types/database"

export function createClient() {
  const { url, publishableKey } = getPublicSupabaseEnv()

  return createBrowserClient<Database>(url, publishableKey)
}
