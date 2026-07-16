import { createHash } from "node:crypto"

export const workstationDeviceCookieName = "labelbox_workstation_device"

export function hashWorkstationDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}
