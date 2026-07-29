"use client"

import { useActionState, useCallback, useMemo, useRef, useState } from "react"
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
import { createLabelBoxPrintJobsAction } from "@/features/label-boxes/verification-actions"
import { initialLabelBoxPrintJobsActionState } from "@/features/label-boxes/verification-form-state"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { formatLabelFields } from "@/lib/label/formatter"
import { buildLabelZpl } from "@/lib/label/zpl"

export function LabelBoxBatchPrintCard({ batchId }: { batchId: string }) {
  const { printers, status } = useQzConnection()
  const selectedPrinter = usePreferredPrinter()
  const [jobsState, jobsAction, jobsPending] = useActionState(
    createLabelBoxPrintJobsAction,
    initialLabelBoxPrintJobsActionState,
  )
  const [printedCount, setPrintedCount] = useState(0)
  const [printError, setPrintError] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const inFlight = useRef(false)

  const activePrinter = resolvePrinter(selectedPrinter, printers)
  const jobs = useMemo(() => jobsState.jobs ?? [], [jobsState.jobs])

  const runPrint = useCallback(async () => {
    if (inFlight.current || !activePrinter || jobs.length === 0) return
    inFlight.current = true
    setPrinting(true)
    setPrintError(null)
    setPrintedCount(0)

    try {
      // Cetak berurutan, bukan paralel: satu printer, dan urutan label harus
      // sama dengan urutan nomor box supaya operator menempelnya runtut.
      for (const job of jobs) {
        const zpl = buildLabelZpl(
          formatLabelFields({
            supplierCode: job.supplierCode,
            partNo: job.partNo,
            partName: job.partName,
            qty: job.qty,
            sequenceNo: 0,
            labelReference: job.labelReference,
            deliveryNumber: job.deliveryNumber,
            deliveryDate: job.deliveryDate,
            boxCode: job.boxNumber,
            boxName: job.boxName,
            qrPayload: job.qrPayload,
          }),
        )

        const claim = await claimPrintJobAction({
          printJobId: job.printJobId,
          zplPayload: zpl,
        })
        if (claim.error) {
          setPrintError(claim.error)
          return
        }

        try {
          await sendZpl(activePrinter, zpl)
        } catch {
          await completePrintJobAction({
            errorCode: "QZ_SEND_FAILED",
            errorMessage: "Gagal mengirim ke printer.",
            printJobId: job.printJobId,
            printerName: activePrinter,
            result: "failed",
          }).catch(() => undefined)
          setPrintError(`Gagal mengirim ${job.boxNumber} ke printer.`)
          return
        }

        const complete = await completePrintJobAction({
          printJobId: job.printJobId,
          printerName: activePrinter,
          result: "sent",
        })
        if (complete.error) {
          setPrintError(complete.error)
          return
        }

        setPrintedCount((count) => count + 1)
      }
    } finally {
      inFlight.current = false
      setPrinting(false)
    }
  }, [activePrinter, jobs])

  return (
    <div className="grid gap-4 rounded-xl border p-5">
      <div className="flex items-center gap-2">
        <PrinterIcon className="size-5" />
        <h2 className="font-semibold">Cetak label batch</h2>
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

      <PrinterPicker
        onSelect={setPreferredPrinter}
        printers={printers}
        selected={selectedPrinter}
      />

      {jobsState.error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertDescription>{jobsState.error}</AlertDescription>
        </Alert>
      ) : null}

      {printError ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Cetak gagal</AlertTitle>
          <AlertDescription>{printError}</AlertDescription>
        </Alert>
      ) : null}

      {jobs.length > 0 && printedCount === jobs.length ? (
        <Alert>
          <CircleCheckIcon />
          <AlertTitle>Semua label tercetak</AlertTitle>
          <AlertDescription>
            {printedCount} label terkirim ke {activePrinter}.
          </AlertDescription>
        </Alert>
      ) : null}

      {jobs.length === 0 ? (
        <form action={jobsAction} noValidate>
          <input name="batchId" type="hidden" value={batchId} />
          <Button disabled={jobsPending} type="submit">
            {jobsPending ? <Spinner data-icon="inline-start" /> : null}
            Siapkan label
          </Button>
        </form>
      ) : (
        <Button
          disabled={printing || status !== "connected" || !activePrinter}
          onClick={() => void runPrint()}
          type="button"
        >
          {printing ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <PrinterIcon data-icon="inline-start" />
          )}
          {printing
            ? `Mencetak ${printedCount + 1} dari ${jobs.length}…`
            : `Cetak ${jobs.length} label`}
        </Button>
      )}
    </div>
  )
}
