import qz from "qz-tray"

let securityConfigured = false

function configureSecurity(): void {
  if (securityConfigured) return
  securityConfigured = true

  // qz-tray treats a plain function as a `(resolve, reject)` promise
  // executor (it wraps it in `new Promise(...)`), so the handlers below
  // must use resolver style rather than returning a promise directly.
  qz.security.setCertificatePromise((resolve, reject) => {
    fetch("/api/qz/cert")
      .then((response) => {
        if (!response.ok) throw new Error("QZ certificate unavailable")
        return response.text()
      })
      .then(resolve, reject)
  })

  qz.security.setSignatureAlgorithm("SHA512")
  qz.security.setSignaturePromise((toSign: string) => (resolve, reject) => {
    fetch("/api/qz/sign", {
      body: JSON.stringify({ request: toSign }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
      .then((response) => {
        if (!response.ok) throw new Error("QZ signing failed")
        return response.json() as Promise<{ signature: string }>
      })
      .then(({ signature }) => resolve(signature), reject)
  })
}

export function isQzConnected(): boolean {
  return qz.websocket.isActive()
}

export async function connectQz(): Promise<void> {
  configureSecurity()
  if (qz.websocket.isActive()) return
  await qz.websocket.connect({ retries: 2, delay: 1 })
}

export async function disconnectQz(): Promise<void> {
  if (qz.websocket.isActive()) await qz.websocket.disconnect()
}

export async function listPrinters(): Promise<string[]> {
  const printers = await qz.printers.find()
  return Array.isArray(printers) ? printers : [printers]
}

export async function sendZpl(
  printerName: string,
  zplPayload: string,
): Promise<void> {
  const config = qz.configs.create(printerName)
  await qz.print(config, [
    { data: zplPayload, flavor: "plain", format: "command", type: "raw" },
  ])
}

export function onQzClosed(handler: () => void): void {
  qz.websocket.setClosedCallbacks(handler)
}
