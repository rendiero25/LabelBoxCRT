import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AppStatus } from "@/components/shared/app-status"

describe("AppStatus", () => {
  it("renders the three foundation status labels", () => {
    const html = renderToStaticMarkup(<AppStatus />)

    expect(html).toContain("Aplikasi siap")
    expect(html).toContain("QZ belum terhubung")
    expect(html).toContain("Printer belum dipetakan")
  })
})
