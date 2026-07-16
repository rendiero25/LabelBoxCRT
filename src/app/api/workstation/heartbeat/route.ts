import { NextResponse } from "next/server"
import { cookies } from "next/headers"

import { getVerifiedAuthContext } from "@/features/auth/server"
import {
  hashWorkstationDeviceToken,
  workstationDeviceCookieName,
} from "@/features/workstations/token"
import { createClient } from "@/lib/supabase/server"

export async function POST() {
  const auth = await getVerifiedAuthContext()
  const cookieStore = await cookies()
  const deviceToken = cookieStore.get(workstationDeviceCookieName)?.value

  if (
    auth.status !== "active" ||
    auth.profile.role !== "operator" ||
    !deviceToken
  ) {
    return NextResponse.json(
      { error: "WORKSTATION_UNAVAILABLE" },
      { status: 401 },
    )
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("workstation_heartbeat", {
    p_device_token_hash: hashWorkstationDeviceToken(deviceToken),
  })

  if (error || !data?.[0]) {
    return NextResponse.json(
      { error: "WORKSTATION_UNAVAILABLE" },
      { status: 403 },
    )
  }

  return NextResponse.json({
    workstationCode: data[0].workstation_code,
    printerName: data[0].printer_name,
  })
}
