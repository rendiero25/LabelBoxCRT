import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

export function PaginationControls({
  currentPage,
  onPageChange,
  pageCount,
  totalItems,
}: {
  currentPage: number
  onPageChange: (page: number) => void
  pageCount: number
  totalItems: number
}) {
  if (pageCount <= 1) return null

  return (
    <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
      <p className="text-muted-foreground text-sm">
        Halaman {currentPage} dari {pageCount} ({totalItems} data)
      </p>
      <div className="flex items-center gap-2">
        <Button
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          size="sm"
          type="button"
          variant="outline"
        >
          <ChevronLeftIcon data-icon="inline-start" />
          Sebelumnya
        </Button>
        <Button
          disabled={currentPage >= pageCount}
          onClick={() => onPageChange(currentPage + 1)}
          size="sm"
          type="button"
          variant="outline"
        >
          Selanjutnya
          <ChevronRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}
