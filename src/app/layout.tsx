import type { Metadata } from "next"
import localFont from "next/font/local"

import { Providers } from "@/components/shared/providers"

import "./globals.css"

const outfit = localFont({
  src: [
    { path: "./fonts/Outfit-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/Outfit-Medium.ttf", weight: "500", style: "normal" },
    {
      path: "./fonts/Outfit-SemiBold.ttf",
      weight: "600",
      style: "normal",
    },
    { path: "./fonts/Outfit-Bold.ttf", weight: "700", style: "normal" },
  ],
  display: "swap",
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
    <html lang="id" className={outfit.variable} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
