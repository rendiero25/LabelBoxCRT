import type { Metadata } from "next"
import { Outfit } from "next/font/google"

import { Providers } from "@/components/shared/providers"

import "./globals.css"

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
})

export const metadata: Metadata = {
  title: "Label Box CRT",
  description: "Sistem scan dan print label box PT CRT Kabelita",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className={`${outfit.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
