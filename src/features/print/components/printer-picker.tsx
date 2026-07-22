"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function PrinterPicker({
  onSelect,
  printers,
  selected,
}: {
  onSelect: (printerName: string) => void
  printers: string[]
  selected: string | null
}) {
  return (
    <Select onValueChange={onSelect} value={selected ?? ""}>
      <SelectTrigger aria-label="Pilih printer" className="w-full">
        <SelectValue placeholder="Pilih printer" />
      </SelectTrigger>
      <SelectContent>
        {printers.length === 0 ? (
          <div className="text-muted-foreground px-2 py-1.5 text-sm">
            Tidak ada printer terdeteksi.
          </div>
        ) : (
          printers.map((printerName) => (
            <SelectItem key={printerName} value={printerName}>
              {printerName}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  )
}
