"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { CircleAlertIcon, CircleCheckIcon, PrinterIcon } from "lucide-react"

import {
  claimPrintJobAction,
  completePrintJobAction,
} from "@/features/print/actions"
import { PrinterPicker } from "@/features/print/components/printer-picker"
import {
  setPreferredPrinter,
  usePreferredPrinter,
} from "@/features/print/components/use-preferred-printer"
import { resolvePrinter } from "@/features/print/printer-preference"
import { sendZpl } from "@/features/print/qz-client"
import { useQzConnection } from "@/features/print/use-qz-connection"
import type { FinalizeSnapshot } from "@/features/finalize/form-state"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { formatLabelFields } from "@/lib/label/formatter"
import { buildLabelZpl } from "@/lib/label/zpl"

type PrintPhase = "waiting" | "printing" | "confirmed" | "failed"

export function PrintJobCard({ snapshot }: { snapshot: FinalizeSnapshot }) {
  const { printers, status } = useQzConnection()
  // Hydration-safe: usePreferredPrinter returns null on the server snapshot
  // and the stored value after hydration (useSyncExternalStore).
  const selectedPrinter = usePreferredPrinter()
  const [phase, setPhase] = useState<PrintPhase>("waiting")
  const [message, setMessage] = useState<string | null>(null)
  const inFlight = useRef(false)
  const autoPrinted = useRef(false)

  const activePrinter = resolvePrinter(selectedPrinter, printers)

  const runPrint = useCallback(async () => {
    if (inFlight.current || !activePrinter) return
    inFlight.current = true
    setPhase("printing")
    setMessage(null)

    try {
      const zpl = buildLabelZpl(formatLabelFields(snapshot))
      const claim = await claimPrintJobAction({
        printJobId: snapshot.printJobId,
        zplPayload: zpl,
      })
      if (claim.error) {
        setPhase("failed")
        setMessage(claim.error)
        return
      }

      try {
        await sendZpl(activePrinter, zpl)
      } catch {
        // sendZpl failed: best-effort mark the job failed server-side, but a
        // rejection here must not escape and leave phase stuck "printing".
        await completePrintJobAction({
          errorCode: "QZ_SEND_FAILED",
          errorMessage: "Gagal mengirim ke printer.",
          printJobId: snapshot.printJobId,
          printerName: activePrinter,
          result: "failed",
        }).catch(() => undefined)
        setPhase("failed")
        setMessage("Gagal mengirim ke printer. Coba lagi.")
        return
      }

      try {
        const complete = await completePrintJobAction({
          printJobId: snapshot.printJobId,
          printerName: activePrinter,
          result: "sent",
        })
        if (complete.error) {
          setPhase("failed")
          setMessage(complete.error)
        } else {
          setPhase("confirmed")
          setMessage(`Label terkirim ke ${activePrinter}.`)
        }
      } catch {
        // sendZpl succeeded but confirming completion failed (e.g. network
        // drop after send). The job stays "printing" server-side; do not
        // attempt a 'failed' completion here since the print may have gone
        // through. A stale re-claim after 2 minutes or a manual retry
        // reconciles the server-side state.
        setPhase("failed")
        setMessage("Print terkirim tetapi konfirmasi gagal. Coba lagi.")
      }
    } finally {
      inFlight.current = false
    }
  }, [activePrinter, snapshot])

  useEffect(() => {
    if (
      autoPrinted.current ||
      phase !== "waiting" ||
      status !== "connected" ||
      !activePrinter
    ) {
      return
    }
    autoPrinted.current = true
    void runPrint()
  }, [activePrinter, phase, runPrint, status])

  if (phase === "confirmed") {
    return (
      <Alert>
        <CircleCheckIcon />
        <AlertTitle>Label tercetak</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="grid gap-4 rounded-xl border p-5">
      <div className="flex items-center gap-2">
        <PrinterIcon className="size-5" />
        <h2 className="font-semibold">Print label</h2>
      </div>

      {status !== "connected" ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>QZ Tray tidak terhubung</AlertTitle>
          <AlertDescription>
            Pastikan aplikasi QZ Tray berjalan. Koneksi dicoba ulang otomatis.
          </AlertDescription>
        </Alert>
      ) : null}

      {status === "connected" && !activePrinter ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Printer belum siap</AlertTitle>
          <AlertDescription>
            {selectedPrinter
              ? "Printer yang tersimpan tidak ditemukan. Pilih ulang printer."
              : "Pilih printer tujuan terlebih dahulu."}
          </AlertDescription>
        </Alert>
      ) : null}

      <PrinterPicker
        onSelect={setPreferredPrinter}
        printers={printers}
        selected={selectedPrinter}
      />

      {phase === "failed" && message ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Print gagal</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        disabled={
          phase === "printing" || status !== "connected" || !activePrinter
        }
        onClick={() => void runPrint()}
        type="button"
      >
        {phase === "printing" ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <PrinterIcon data-icon="inline-start" />
        )}
        {phase === "failed" ? "Retry Print" : "Print label"}
      </Button>
    </div>
  )
}
