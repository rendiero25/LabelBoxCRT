import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { requireOperator } from "@/features/auth/server"
import {
  hashWorkstationDeviceToken,
  workstationDeviceCookieName,
} from "@/features/workstations/token"
import { createClient } from "@/lib/supabase/server"

export type ActiveWorkstation = {
  id: string
  code: string
  printerName: string
  printerModel: string
  scannerModel: string
}

export async function getVerifiedWorkstation(): Promise<ActiveWorkstation | null> {
  await requireOperator()
  const cookieStore = await cookies()
  const deviceToken = cookieStore.get(workstationDeviceCookieName)?.value

  if (!deviceToken) return null

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("workstation_heartbeat", {
    p_device_token_hash: hashWorkstationDeviceToken(deviceToken),
  })

  if (error || !data?.[0]) return null

  return {
    id: data[0].workstation_id,
    code: data[0].workstation_code,
    printerName: data[0].printer_name,
    printerModel: data[0].printer_model,
    scannerModel: data[0].scanner_model,
  }
}

export async function requireVerifiedWorkstation(): Promise<ActiveWorkstation> {
  const workstation = await getVerifiedWorkstation()

  if (!workstation) redirect("/workstation/enroll?reason=workstation-required")

  return workstation
}
