"use client"

import { useActionState, useMemo, useState } from "react"
import { CircleAlertIcon, FileSpreadsheetIcon, UploadIcon } from "lucide-react"

import {
  commitCsvImportAction,
  previewCsvImportAction,
} from "@/features/csv-imports/actions"
import { initialCsvImportActionState } from "@/features/csv-imports/form-state"
import {
  csvImportTemplateKeys,
  getCsvImportTemplate,
  type CsvImportTemplateKey,
} from "@/features/csv-imports/templates"
import { useActionStateToast } from "@/components/shared/action-state-toast"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const defaultTemplate: CsvImportTemplateKey = "suppliers"

export function CsvImportWorkspace() {
  const [templateKey, setTemplateKey] =
    useState<CsvImportTemplateKey>(defaultTemplate)
  const [previewState, previewAction, isPreviewPending] = useActionState(
    previewCsvImportAction,
    initialCsvImportActionState,
  )
  const [commitState, commitAction, isCommitPending] = useActionState(
    commitCsvImportAction,
    initialCsvImportActionState,
  )
  const template = useMemo(
    () => getCsvImportTemplate(templateKey),
    [templateKey],
  )
  const preview = commitState.success
    ? undefined
    : (commitState.preview ?? previewState.preview)

  useActionStateToast(commitState)

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="rounded-xl border p-5">
        <form action={previewAction} className="flex flex-col gap-5" noValidate>
          <input name="template" type="hidden" value={templateKey} />
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="csv-template">Template</FieldLabel>
              <Select
                value={templateKey}
                onValueChange={(value) => {
                  if (value in Object.fromEntries(
                    csvImportTemplateKeys.map((key) => [key, true]),
                  )) {
                    setTemplateKey(value as CsvImportTemplateKey)
                  }
                }}
              >
                <SelectTrigger className="w-full" id="csv-template">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {csvImportTemplateKeys.map((key) => (
                      <SelectItem key={key} value={key}>
                        {getCsvImportTemplate(key).label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                Hanya data baru. Import tidak mengubah atau menghapus data lama.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="csv-file">Berkas CSV</FieldLabel>
              <Input
                accept=".csv,text/csv"
                id="csv-file"
                name="file"
                required
                type="file"
              />
              <FieldDescription>
                UTF-8, maksimal 500 baris data dan 512 KB.
              </FieldDescription>
            </Field>
          </FieldGroup>

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={isPreviewPending} type="submit">
              {isPreviewPending ? <Spinner data-icon="inline-start" /> : <UploadIcon data-icon="inline-start" />}
              Preview validasi
            </Button>
            <Button asChild size="sm" type="button" variant="outline">
              <a
                download={`${template.databaseType}-template.csv`}
                href={`data:text/csv;charset=utf-8,${encodeURIComponent(template.sample)}`}
              >
                <FileSpreadsheetIcon data-icon="inline-start" />
                Unduh template {template.label}
              </a>
            </Button>
          </div>
        </form>

        {previewState.error ? (
          <Alert className="mt-5" variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>Preview gagal</AlertTitle>
            <AlertDescription>{previewState.error}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      {commitState.error ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Import gagal</AlertTitle>
          <AlertDescription>{commitState.error}</AlertDescription>
        </Alert>
      ) : null}

      {preview ? (
        <div className="flex flex-col gap-5 rounded-xl border p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">Preview {preview.label}</h2>
              <p className="text-muted-foreground text-sm">
                Import hanya aktif bila semua baris valid.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{preview.totalRows} baris</Badge>
              <Badge variant="secondary">{preview.validRows} valid</Badge>
              <Badge variant={preview.errorRows ? "destructive" : "outline"}>
                {preview.errorRows} error
              </Badge>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Baris</TableHead>
                  {preview.headers.map((header) => (
                    <TableHead key={header}>{header}</TableHead>
                  ))}
                  <TableHead>Validasi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((row) => (
                  <TableRow key={row.line}>
                    <TableCell>{row.line}</TableCell>
                    {preview.headers.map((header) => (
                      <TableCell key={header}>{row.values[header]}</TableCell>
                    ))}
                    <TableCell>
                      {row.errors.length === 0 ? (
                        <Badge variant="secondary">Valid</Badge>
                      ) : (
                        <ul className="text-destructive flex list-disc flex-col gap-1 pl-4 text-sm">
                          {row.errors.map((error) => (
                            <li key={error}>{error}</li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <form action={commitAction}>
            <input name="payload" type="hidden" value={preview.payload} />
            <input name="template" type="hidden" value={preview.template} />
            <Button disabled={!preview.canImport || isCommitPending} type="submit">
              {isCommitPending ? <Spinner data-icon="inline-start" /> : null}
              Import {preview.validRows} baris
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
