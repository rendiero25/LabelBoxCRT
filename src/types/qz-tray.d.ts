declare module "qz-tray" {
  type PromiseResolver<T> = (
    resolve: (value: T) => void,
    reject: (reason?: unknown) => void,
  ) => void

  interface QzPrintData {
    data: string
    flavor?: "base64" | "file" | "hex" | "plain" | "xml"
    format?: "command" | "html" | "image" | "pdf"
    type?: "html" | "image" | "pdf" | "pixel" | "raw"
  }

  interface QzConfig {
    getPrinter(): string | { name: string }
  }

  interface QzConnectOptions {
    delay?: number
    retries?: number
  }

  interface QzUsbDevice {
    hub?: boolean
    productId?: number | string
    vendorId?: number | string
  }

  const qz: {
    usb: {
      listDevices(includeHubs?: boolean): Promise<QzUsbDevice[]>
    }
    configs: {
      create(
        printer: string | { name: string },
        options?: Record<string, unknown>,
      ): QzConfig
    }
    print(config: QzConfig, data: QzPrintData[]): Promise<void>
    printers: {
      find(query?: string): Promise<string | string[]>
    }
    security: {
      setCertificatePromise(
        promiseHandler:
          | PromiseResolver<string>
          | (() => Promise<string>)
          | Promise<string>,
        options?: { rejectOnFailure?: boolean },
      ): void
      setSignatureAlgorithm(algorithm: "SHA1" | "SHA256" | "SHA512"): void
      setSignaturePromise(
        promiseFactory: (
          toSign: string,
        ) => PromiseResolver<string> | Promise<string>,
      ): void
    }
    websocket: {
      connect(options?: QzConnectOptions): Promise<void>
      disconnect(): Promise<void>
      isActive(): boolean
      setClosedCallbacks(
        calls: ((event: unknown) => void) | ((event: unknown) => void)[],
      ): void
    }
  }

  export default qz
}
