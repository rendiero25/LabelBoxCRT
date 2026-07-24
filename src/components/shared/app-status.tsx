"use client"

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  type LucideIcon,
} from "lucide-react"

import { PrinterPicker } from "@/features/print/components/printer-picker"
import {
  setPreferredPrinter,
  usePreferredPrinter,
} from "@/features/print/components/use-preferred-printer"
import { resolvePrinter } from "@/features/print/printer-preference"
import { useQzConnection } from "@/features/print/use-qz-connection"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type ReadinessState = "ok" | "attention" | "pending"

type ReadinessItem = {
  key: string
  label: string
  detail: string
  state: ReadinessState
}

const STATE_STYLES: Record<
  ReadinessState,
  { icon: LucideIcon; iconClassName: string }
> = {
  ok: { icon: CheckCircle2Icon, iconClassName: "text-success" },
  attention: { icon: AlertTriangleIcon, iconClassName: "text-warning" },
  pending: {
    icon: Loader2Icon,
    iconClassName: "text-muted-foreground animate-spin",
  },
}

const TRIGGER_STYLES: Record<ReadinessState, string> = {
  ok: "border-success/30 bg-success/10 text-success",
  attention: "border-warning/30 bg-warning/10 text-warning",
  pending: "border-border bg-muted text-muted-foreground",
}

const OVERALL_LABEL: Record<ReadinessState, string> = {
  ok: "Sistem siap",
  attention: "Perlu perhatian",
  pending: "Memeriksa sistem",
}

export function AppStatus() {
  const { printers, status } = useQzConnection()
  // Hydration-safe: null on the server snapshot, stored value after
  // hydration (useSyncExternalStore under the hood).
  const printer = usePreferredPrinter()
  const activePrinter = resolvePrinter(printer, printers)

  const items: ReadinessItem[] = [
    {
      key: "qz",
      label: "QZ Tray",
      state:
        status === "connected"
          ? "ok"
          : status === "connecting"
            ? "pending"
            : "attention",
      detail:
        status === "connected"
          ? "Terhubung"
          : status === "connecting"
            ? "Menghubungkan..."
            : status === "error"
              ? "Gagal terhubung, mencoba ulang"
              : "Belum terhubung",
    },
    {
      key: "printer",
      label: "Printer",
      state: activePrinter ? "ok" : "attention",
      detail: activePrinter ?? (printer ? "Printer tersimpan tidak ditemukan" : "Belum dipilih"),
    },
  ]

  const overall: ReadinessState = items.some((item) => item.state === "pending")
    ? "pending"
    : items.every((item) => item.state === "ok")
      ? "ok"
      : "attention"
  const OverallIcon = STATE_STYLES[overall].icon

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="Status sistem"
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
            TRIGGER_STYLES[overall],
          )}
          type="button"
        >
          <OverallIcon
            className={cn("size-3.5", STATE_STYLES[overall].iconClassName)}
          />
          {OVERALL_LABEL[overall]}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="flex flex-col gap-0.5 px-0.5 pb-1">
          <p className="text-sm font-medium">Status sistem</p>
          <p className="text-muted-foreground text-xs">
            Pengecekan kesiapan sebelum scan.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          {items.map((item) => {
            const Icon = STATE_STYLES[item.state].icon
            return (
              <div
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5"
                key={item.key}
              >
                <div className="flex items-center gap-2">
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      STATE_STYLES[item.state].iconClassName,
                    )}
                  />
                  <span className="text-sm">{item.label}</span>
                </div>
                <span className="text-muted-foreground text-xs">
                  {item.detail}
                </span>
              </div>
            )
          })}
        </div>
        <div className="flex flex-col gap-1.5 border-t pt-2">
          <p className="text-muted-foreground px-0.5 text-xs font-medium">
            Pilih printer
          </p>
          <PrinterPicker
            onSelect={setPreferredPrinter}
            printers={printers}
            selected={printer}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
