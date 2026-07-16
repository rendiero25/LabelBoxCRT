"use client"

import { useMemo, useState } from "react"
import { SearchIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  CreateSupplierDialog,
  EditSupplierDialog,
} from "@/features/suppliers/components/supplier-form-dialog"
import { SupplierRowActions } from "@/features/suppliers/components/supplier-row-actions"

type Supplier = {
  id: string
  supplier_code: string
  supplier_name: string
  is_active: boolean
}

type StatusFilter = "all" | "active" | "inactive"

export function SupplierDirectory({ suppliers }: { suppliers: Supplier[] }) {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")

  const filteredSuppliers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("id-ID")

    return suppliers.filter((supplier) => {
      const matchesQuery =
        !normalizedQuery ||
        supplier.supplier_code
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery) ||
        supplier.supplier_name
          .toLocaleLowerCase("id-ID")
          .includes(normalizedQuery)
      const matchesStatus =
        status === "all" ||
        (status === "active" ? supplier.is_active : !supplier.is_active)

      return matchesQuery && matchesStatus
    })
  }, [query, status, suppliers])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-3 sm:grid-cols-[minmax(16rem,24rem)_10rem]">
          <div className="relative">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-2 left-2.5 size-4" />
            <Input
              aria-label="Cari supplier"
              className="pl-8"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cari kode atau nama supplier"
              value={query}
            />
          </div>
          <Select
            value={status}
            onValueChange={(value) => setStatus(value as StatusFilter)}
          >
            <SelectTrigger
              className="w-full"
              aria-label="Filter status supplier"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              <SelectItem value="active">Aktif</SelectItem>
              <SelectItem value="inactive">Nonaktif</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <CreateSupplierDialog />
      </div>

      {filteredSuppliers.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Tidak ada supplier</EmptyTitle>
            <EmptyDescription>
              Ubah pencarian/filter atau buat supplier baru.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Nama supplier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSuppliers.map((supplier) => (
                <TableRow key={supplier.id}>
                  <TableCell className="font-medium">
                    {supplier.supplier_code}
                  </TableCell>
                  <TableCell>{supplier.supplier_name}</TableCell>
                  <TableCell>
                    <Badge
                      variant={supplier.is_active ? "secondary" : "outline"}
                    >
                      {supplier.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-start gap-2">
                      <EditSupplierDialog supplier={supplier} />
                      <SupplierRowActions
                        supplierId={supplier.id}
                        isActive={supplier.is_active}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
