"use client"

import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { CircleAlertIcon, CircleCheckIcon, PrinterIcon } from "lucide-react"
import QRCode from "qrcode"

import {
  claimPrintJobAction,
  completePrintJobAction,
} from "@/features/print/actions"
import { PrinterPicker } from "@/features/print/components/printer-picker"
import {
  setPreferredPrinter,
  usePreferredPrinter,
} from "@/features/print/components/use-preferred-printer"
import { loadLabelFontUploads } from "@/features/print/label-font-loader"
import {
  autoSelectPrinter,
  printerKindFor,
} from "@/features/print/printer-preference"
import { sendHtmlSheets, sendZplBatch } from "@/features/print/qz-client"
import { useQzConnection } from "@/features/print/use-qz-connection"
import {
  createLabelBoxPrintJobsAction,
  createLabelBoxReprintJobsAction,
} from "@/features/label-boxes/verification-actions"
import {
  initialLabelBoxPrintJobsActionState,
  type LabelBoxPrintJob,
} from "@/features/label-boxes/verification-form-state"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { isFirstLabelOfBatch } from "@/lib/label/box-number"
import { formatLabelFields } from "@/lib/label/formatter"
import { buildLabelHtml, buildLabelSheetsHtml } from "@/lib/label/html"
import { buildLabelZpl, LABEL_DOTS_PER_MM, LABEL_LAYOUT } from "@/lib/label/zpl"

/**
 * Preview label mengikuti lebar kolomnya, bukan lebar tetap: di kolom setengah
 * kartu itu berarti labelnya tercetak di layar sekitar dua kali ukuran aslinya,
 * dan isi yang paling kecil -- nama field, baris QC -- masih terbaca sebelum
 * stikernya keluar dari printer.
 *
 * Ukuran aslinya diturunkan dari LABEL_LAYOUT, bukan ditulis ulang, supaya
 * label yang berubah bentuk di templat ikut berubah bentuk di preview.
 */
const MM_PER_INCH = 25.4
const CSS_PX_PER_INCH = 96

const LABEL_WIDTH_MM = LABEL_LAYOUT.labelWidth / LABEL_DOTS_PER_MM
const LABEL_HEIGHT_MM = LABEL_LAYOUT.labelHeight / LABEL_DOTS_PER_MM
const LABEL_WIDTH_PX = (LABEL_WIDTH_MM * CSS_PX_PER_INCH) / MM_PER_INCH
const LABEL_HEIGHT_PX = (LABEL_HEIGHT_MM * CSS_PX_PER_INCH) / MM_PER_INCH

/**
 * Lebar kolom preview sebelum terukur: dipakai pada render pertama dan di
 * server, lalu langsung diganti lebar sebenarnya oleh ResizeObserver.
 */
const PREVIEW_FALLBACK_WIDTH_PX = 260

/**
 * Lebar kolom preview yang sedang berlaku. Diukur, bukan ditebak: kolomnya ikut
 * lebar jendela, dan skala preview harus mengikutinya supaya label tidak
 * terpotong saat jendelanya menyempit.
 */
function usePreviewWidth(): [(node: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(PREVIEW_FALLBACK_WIDTH_PX)
  const observer = useRef<ResizeObserver | null>(null)

  // Callback ref, bukan useEffect: kotak previewnya baru dipasang setelah job
  // cetak siap, jadi elemennya belum ada saat efek pertama berjalan.
  const ref = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect()
    // Tanpa ResizeObserver previewnya tetap tampil pada lebar cadangan, bukan
    // menjatuhkan seluruh kartu cetak.
    if (!node || typeof ResizeObserver === "undefined") return

    observer.current = new ResizeObserver(([entry]) => {
      const measured = entry.contentRect.width
      if (measured > 0) setWidth(measured)
    })
    observer.current.observe(node)
  }, [])

  useEffect(() => () => observer.current?.disconnect(), [])

  return [ref, width]
}

export function LabelBoxBatchPrintCard({
  batchId,
  onPrinted,
}: {
  batchId: string
  onPrinted?: () => void
}) {
  const { printerError, printers, refreshPrinters, status } = useQzConnection()
  const selectedPrinter = usePreferredPrinter()
  const [jobsState, jobsAction, jobsPending] = useActionState(
    createLabelBoxPrintJobsAction,
    initialLabelBoxPrintJobsActionState,
  )
  const [printRun, setPrintRun] = useState<{
    done: number
    total: number
  } | null>(null)
  const [printError, setPrintError] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [reprintError, setReprintError] = useState<string | null>(null)
  const [selectedBoxIds, setSelectedBoxIds] = useState<string[]>([])
  const [preview, setPreview] = useState<{
    boxNumber: string
    html: string
  } | null>(null)
  const [previewRef, previewWidth] = usePreviewWidth()
  const previewScale = previewWidth / LABEL_WIDTH_PX
  const inFlight = useRef(false)

  const activePrinter = autoSelectPrinter(selectedPrinter, printers)
  const jobs = useMemo(() => jobsState.jobs ?? [], [jobsState.jobs])
  // Job yang sudah selesai tidak bisa diklaim ulang; menekan Cetak untuk job
  // seperti itu berakhir PRINT_JOB_NOT_CLAIMABLE.
  const printableJobs = useMemo(
    () => jobs.filter((job) => job.status === "pending"),
    [jobs],
  )
  const alreadyPrinted = jobs.length > 0 && printableJobs.length === 0

  /**
   * Kenapa tombolnya mati, ditulis apa adanya. Sebelumnya tombol nonaktif itu
   * bisu: operator melihat "Cetak 3 label" yang tidak bisa ditekan, dan
   * satu-satunya petunjuk ada di panel status header — yang punya sambungan QZ
   * sendiri dan bisa hijau walau sambungan kartu ini tidak.
   */
  const blockedReason =
    status !== "connected"
      ? "QZ Tray belum terhubung dari halaman ini. Koneksi dicoba ulang otomatis."
      : // Daftar kosong bukan "belum memilih": tidak ada yang bisa dipilih, dan
        // menyuruh memilih di sana membuat operator menekan daftar kosong
        // berulang kali sambil mengira dirinya salah pakai.
        printers.length === 0
        ? (printerError ??
          "QZ Tray terhubung tetapi tidak melaporkan satu printer pun.")
        : !activePrinter
          ? "Pilih printer dulu di daftar di atas."
          : printableJobs.length === 0 && !alreadyPrinted
            ? "Belum ada label yang siap dicetak."
            : null

  // Label disiapkan begitu kartu muncul, jadi operator hanya menekan Cetak.
  const prepared = useRef(false)
  useEffect(() => {
    if (prepared.current || jobs.length > 0 || jobsPending) return
    prepared.current = true
    const formData = new FormData()
    formData.set("batchId", batchId)
    // Aksi useActionState yang dipanggil dari efek, bukan dari prop action
    // sebuah form, harus dibungkus transition sendiri; tanpa itu React tidak
    // memperbarui isPending dan tombol Cetak tidak pernah kelihatan menunggu.
    startTransition(() => jobsAction(formData))
  }, [batchId, jobs.length, jobsAction, jobsPending])

  /**
   * Label box pertama dirakit sebagai preview lewat jalur yang sama dengan
   * cetak kertas, QR sungguhan dan semua. Operator karena itu memeriksa lot,
   * tanggal, dan nomor box sebelum stikernya keluar, bukan setelah tertempel.
   *
   * Gagalnya perakitan hanya menghilangkan previewnya. Preview bukan syarat
   * cetak, dan peringatan merah di kartu ini akan terbaca seolah cetaknya yang
   * gagal.
   */
  useEffect(() => {
    const job = jobs[0]
    if (!job) return

    let cancelled = false
    const fields = formatLabelFields({
      boxNumber: job.boxNumber,
      deliveryDate: job.deliveryDate,
      lotNo: job.lotNo,
      masterItemRowNo: job.masterItemRowNo,
      operatorName: job.operatorName,
      packingDate: job.packingDate,
      packingQty: job.qty,
      partNo: job.partNo,
      qrPayload: job.qrPayload,
      qtyDelivery: job.qtyDelivery,
      supplierCode: job.supplierCode,
      supplierName: job.supplierName,
    })

    const qr = isFirstLabelOfBatch(job.boxNumber)
      ? QRCode.toDataURL(fields.qrPayload, { margin: 0, width: 240 })
      : Promise.resolve(null)

    qr.then((qrDataUrl) => {
      if (cancelled) return
      setPreview({
        boxNumber: job.boxNumber,
        html: buildLabelHtml(fields, qrDataUrl),
      })
    }).catch(() => {
      if (!cancelled) setPreview(null)
    })

    return () => {
      cancelled = true
    }
  }, [jobs])

  /**
   * Mencetak satu rombongan job: klaim, kirim sekali ke QZ, lalu tandai
   * selesai. Dipakai cetak pertama maupun cetak ulang supaya keduanya tidak
   * punya dua jalur yang bisa berbeda perilaku.
   */
  const printJobs = useCallback(
    async (jobsToPrint: LabelBoxPrintJob[]) => {
      if (inFlight.current || !activePrinter || jobsToPrint.length === 0) return
      inFlight.current = true
      setPrinting(true)
      setPrintError(null)
      setPrintRun({ done: 0, total: jobsToPrint.length })

      // Printer label diberi ZPL mentah, printer kertas diberi HTML lewat mode
      // pixel. Canon G4010 dan sejenisnya tidak mengerti ZPL sama sekali, dan
      // perintah mentah yang dikirim ke sana keluar sebagai halaman berisi teks
      // "^XA^CI28" apa adanya.
      const printerKind = printerKindFor(activePrinter)

      /**
       * Job yang sudah diklaim tapi belum ditutup. Klaim mengubah statusnya
       * jadi 'printing', dan job 'printing' baru boleh diklaim ulang setelah
       * dua menit. Berhenti di tengah tanpa melepasnya berarti percobaan
       * berikutnya ditolak PRINT_JOB_NOT_CLAIMABLE — persis keadaan operator
       * yang cetak pertamanya gagal lalu menekan Cetak lagi.
       */
      const claimed = new Set<string>()

      const releaseClaims = async (
        errorCode: string,
        errorMessage: string,
      ): Promise<void> => {
        if (claimed.size === 0) return
        const abandoned = [...claimed]
        claimed.clear()
        await Promise.all(
          abandoned.map((printJobId) =>
            completePrintJobAction({
              errorCode,
              errorMessage,
              printerName: activePrinter,
              printJobId,
              result: "failed",
            }).catch(() => undefined),
          ),
        )
      }

      try {
        // Urutan label mengikuti urutan nomor box supaya operator menempelnya
        // runtut. Payload disiapkan lebih dulu untuk semuanya, lalu dikirim
        // dalam satu panggilan QZ: mengirim satu per satu memunculkan
        // konfirmasi QZ sebanyak jumlah label.
        const payloads: string[] = []
        for (const job of jobsToPrint) {
          const fields = formatLabelFields({
            boxNumber: job.boxNumber,
            deliveryDate: job.deliveryDate,
            lotNo: job.lotNo,
            masterItemRowNo: job.masterItemRowNo,
            operatorName: job.operatorName,
            packingDate: job.packingDate,
            packingQty: job.qty,
            partNo: job.partNo,
            qrPayload: job.qrPayload,
            qtyDelivery: job.qtyDelivery,
            supplierCode: job.supplierCode,
            supplierName: job.supplierName,
          })

          // QR hanya milik label pertama batch; label lain memakai kolom
          // kanannya untuk penanda FIFO saja.
          const showQr = isFirstLabelOfBatch(job.boxNumber)

          // QR dirakit printer sendiri pada jalur ZPL, tapi pada jalur HTML
          // harus ikut jadi gambar di dalam labelnya.
          const payload =
            printerKind === "label"
              ? buildLabelZpl(fields, { showQr })
              : buildLabelHtml(
                  fields,
                  showQr
                    ? await QRCode.toDataURL(fields.qrPayload, {
                        margin: 0,
                        width: 240,
                      })
                    : null,
                )

          // Yang disimpan adalah payload yang benar-benar dikirim ke printer,
          // jadi rekaman job tetap cocok dengan hasil cetaknya saat diperiksa.
          const claim = await claimPrintJobAction({
            printJobId: job.printJobId,
            zplPayload: payload,
          })
          if (claim.error) {
            setPrintError(claim.error)
            return
          }

          claimed.add(job.printJobId)
          payloads.push(payload)
        }

        try {
          if (printerKind === "label") {
            // Font Outfit ditanam lebih dulu dalam panggilan yang sama: label
            // merujuk berkas di memori printer, dan printer yang baru di-reset
            // tidak lagi memilikinya.
            const fontUploads = await loadLabelFontUploads()
            await sendZplBatch(activePrinter, [...fontUploads, ...payloads])
          } else {
            await sendHtmlSheets(activePrinter, buildLabelSheetsHtml(payloads))
          }
        } catch {
          await releaseClaims("QZ_SEND_FAILED", "Gagal mengirim ke printer.")
          setPrintError("Gagal mengirim label ke printer.")
          return
        }

        for (const job of jobsToPrint) {
          const complete = await completePrintJobAction({
            printJobId: job.printJobId,
            printerName: activePrinter,
            result: "sent",
          })
          if (complete.error) {
            setPrintError(complete.error)
            return
          }

          claimed.delete(job.printJobId)
          setPrintRun((run) =>
            run ? { done: run.done + 1, total: run.total } : run,
          )
        }

        onPrinted?.()
      } finally {
        // Apa pun sebab berhentinya — klaim ditolak, penutupan gagal, atau
        // pengecualian tak terduga — job yang masih tergantung dilepas di sini
        // supaya tombol Cetak langsung bisa ditekan lagi, bukan setelah dua
        // menit.
        await releaseClaims(
          "PRINT_ABORTED",
          "Cetak berhenti sebelum labelnya selesai.",
        )
        inFlight.current = false
        setPrinting(false)
      }
    },
    [activePrinter, onPrinted],
  )

  const runPrint = useCallback(
    () => printJobs(printableJobs),
    [printJobs, printableJobs],
  )

  /**
   * Cetak ulang sekali tekan: job penggantinya dibuat lalu langsung dicetak.
   * Daftar centang tetap seperti semula setelah selesai, karena operator yang
   * kertasnya habis biasanya mencetak ulang beberapa kali berturut-turut.
   */
  const runReprint = useCallback(
    async (labelBoxIds?: string[]) => {
      setReprintError(null)
      const result = await createLabelBoxReprintJobsAction({
        batchId,
        labelBoxIds,
      })

      if (result.error || !result.jobs?.length) {
        setReprintError(
          result.error ?? "Tidak ada label yang bisa dicetak ulang.",
        )
        return
      }

      setSelectedBoxIds([])
      await printJobs(result.jobs)
    },
    [batchId, printJobs],
  )

  return (
    <div className="grid gap-4 rounded-xl border p-5">
      <div className="flex items-center gap-2">
        <PrinterIcon className="size-5" />
        <h2 className="font-semibold">Cetak label batch</h2>
      </div>

      {/* Dua kolom sama lebar: kendali cetak di kiri, preview label di kanan.
          minmax(0,1fr) dua kali, bukan grid-cols-2, supaya isi yang panjang
          (nama printer, pesan gagal) menyusut di dalam kolomnya dan tidak
          melebarkan kartunya. */}
      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-4">
          {status !== "connected" ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>QZ Tray tidak terhubung</AlertTitle>
              <AlertDescription>
                Pastikan aplikasi QZ Tray berjalan. Koneksi dicoba ulang
                otomatis.
              </AlertDescription>
            </Alert>
          ) : null}

          {status === "connected" && !activePrinter ? (
            <div className="grid gap-2">
              <PrinterPicker
                onSelect={setPreferredPrinter}
                printers={printers}
                selected={selectedPrinter}
              />
              {/* Daftar printer dibaca lewat panggilan bertanda tangan, dan
                  tanda tangannya bisa ditolak walau sambungan QZ hijau.
                  Sebabnya ditulis apa adanya, lengkap dengan status HTTP-nya,
                  dan operator bisa mencoba lagi tanpa memutus sambungan. */}
              {printers.length === 0 ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-muted-foreground text-sm">
                    {printerError ?? "Belum ada printer yang terbaca."}
                  </p>
                  <Button
                    onClick={() => void refreshPrinters()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Muat ulang daftar printer
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {(jobsState.error ?? reprintError) ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>
                {jobsState.error ?? reprintError}
              </AlertDescription>
            </Alert>
          ) : null}

          {printError ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Cetak gagal</AlertTitle>
              <AlertDescription>{printError}</AlertDescription>
            </Alert>
          ) : null}

          {printRun && printRun.done === printRun.total ? (
            <Alert>
              <CircleCheckIcon />
              <AlertTitle>Label tercetak</AlertTitle>
              <AlertDescription>
                {printRun.done} label terkirim ke {activePrinter}.
              </AlertDescription>
            </Alert>
          ) : null}

          {/* Label yang sudah keluar dari printer tidak bisa dicetak lagi lewat job
          yang sama. Pilih box yang labelnya rusak atau hilang, atau cetak ulang
          seluruh batch; keduanya membuat label pengganti yang identik. */}
          {alreadyPrinted ? (
            <div className="grid gap-3">
              <p className="text-muted-foreground text-sm">
                Label batch ini sudah tercetak. Pilih box yang perlu dicetak
                ulang, atau cetak ulang semuanya.
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {jobs.map((job) => (
                  <label
                    className="hover:bg-muted/50 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                    key={job.labelBoxId}
                  >
                    <input
                      checked={selectedBoxIds.includes(job.labelBoxId)}
                      className="accent-primary size-4"
                      onChange={(event) =>
                        setSelectedBoxIds((current) =>
                          event.target.checked
                            ? [...current, job.labelBoxId]
                            : current.filter((id) => id !== job.labelBoxId),
                        )
                      }
                      type="checkbox"
                    />
                    <span className="font-mono">{job.boxNumber}</span>
                    <span className="text-muted-foreground truncate">
                      {job.boxName}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {alreadyPrinted ? (
              <>
                <Button
                  disabled={
                    printing ||
                    selectedBoxIds.length === 0 ||
                    status !== "connected" ||
                    !activePrinter
                  }
                  onClick={() => void runReprint(selectedBoxIds)}
                  type="button"
                >
                  {printing ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <PrinterIcon data-icon="inline-start" />
                  )}
                  Cetak ulang {selectedBoxIds.length || ""} terpilih
                </Button>
                <Button
                  disabled={
                    printing || status !== "connected" || !activePrinter
                  }
                  onClick={() => void runReprint()}
                  type="button"
                  variant="outline"
                >
                  Cetak ulang semua
                </Button>
              </>
            ) : (
              <Button
                disabled={
                  printing ||
                  jobsPending ||
                  printableJobs.length === 0 ||
                  status !== "connected" ||
                  !activePrinter
                }
                onClick={() => void runPrint()}
                type="button"
              >
                {printing || jobsPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <PrinterIcon data-icon="inline-start" />
                )}
                {jobsPending
                  ? "Menyiapkan label…"
                  : printing
                    ? `Mencetak ${printableJobs.length} label…`
                    : `Cetak ${printableJobs.length || ""} label`.replace(
                        "  ",
                        " ",
                      )}
              </Button>
            )}
            {activePrinter ? (
              <span className="text-muted-foreground text-sm">
                Printer: {activePrinter}
              </span>
            ) : null}
          </div>

          {blockedReason && !printing ? (
            <p className="text-muted-foreground text-sm">{blockedReason}</p>
          ) : null}
        </div>

        {/* Label yang akan keluar dari printer, dirakit dari data batch ini
            sendiri. Kotaknya selalu putih: label dicetak di atas kertas putih,
            dan preview yang ikut tema gelap tidak lagi menunjukkan hasilnya. */}
        {preview && jobs.length > 0 ? (
          <div className="grid min-w-0 gap-2">
            <p className="text-muted-foreground text-sm">
              Preview label ·{" "}
              <span className="font-mono">{preview.boxNumber}</span>
            </p>
            {/* Kotak luar yang diukur; tingginya mengikuti skala supaya rasio
                label 75x55 mm tetap terjaga berapa pun lebar kolomnya. */}
            <div
              className="w-full overflow-hidden rounded-md border bg-white"
              ref={previewRef}
              style={{ height: LABEL_HEIGHT_PX * previewScale }}
            >
              <div
                dangerouslySetInnerHTML={{ __html: preview.html }}
                style={{
                  transform: `scale(${previewScale})`,
                  transformOrigin: "top left",
                }}
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
