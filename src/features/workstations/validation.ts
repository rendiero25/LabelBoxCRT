const workstationCodePattern = /^[A-Z0-9][A-Z0-9_-]{1,63}$/

function asTrimmedString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : ""
}

export type RegisterWorkstationInput = {
  workstationCode: string
  name: string
  printerName: string
  printerModel: string
  scannerModel: string
  operatorId: string
}

export function parseRegisterWorkstationInput(
  formData: FormData,
): { data: RegisterWorkstationInput } | { error: string } {
  const workstationCode = asTrimmedString(
    formData.get("workstationCode"),
  ).toUpperCase()
  const name = asTrimmedString(formData.get("name"))
  const printerName = asTrimmedString(formData.get("printerName"))
  const printerModel = asTrimmedString(formData.get("printerModel"))
  const scannerModel = asTrimmedString(formData.get("scannerModel"))
  const operatorId = asTrimmedString(formData.get("operatorId"))

  if (!workstationCodePattern.test(workstationCode)) {
    return {
      error:
        "Kode workstation harus 2–64 karakter A–Z, angka, garis bawah, atau tanda minus.",
    }
  }

  if (!name || !printerName || !printerModel || !scannerModel || !operatorId) {
    return { error: "Semua field workstation dan operator wajib diisi." }
  }

  return {
    data: {
      workstationCode,
      name,
      printerName,
      printerModel,
      scannerModel,
      operatorId,
    },
  }
}

export function parseEnrollmentCode(
  formData: FormData,
): { data: { enrollmentCode: string } } | { error: string } {
  const enrollmentCode = asTrimmedString(formData.get("enrollmentCode"))

  if (!/^[a-f0-9]{64}$/i.test(enrollmentCode)) {
    return { error: "Kode enrollment tidak valid." }
  }

  return { data: { enrollmentCode } }
}

export function parseDisableReason(
  formData: FormData,
): { data: { workstationId: string; reason: string } } | { error: string } {
  const workstationId = asTrimmedString(formData.get("workstationId"))
  const reason = asTrimmedString(formData.get("reason"))

  if (!workstationId || !reason) {
    return { error: "Alasan menonaktifkan workstation wajib diisi." }
  }

  return { data: { workstationId, reason } }
}
