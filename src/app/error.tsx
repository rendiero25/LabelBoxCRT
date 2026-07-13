"use client"

import { AlertCircleIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="mx-auto flex min-h-svh max-w-xl items-center px-6">
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>Aplikasi mengalami kendala</AlertTitle>
        <AlertDescription className="space-y-4">
          <p>
            Coba muat ulang area kerja. Jika masalah berulang, hubungi
            supervisor.
          </p>
          <Button type="button" variant="outline" onClick={reset}>
            Coba lagi
          </Button>
        </AlertDescription>
      </Alert>
    </main>
  )
}
