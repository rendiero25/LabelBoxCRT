import Image from "next/image"
import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function HomePage() {
  return (
    <main className="relative h-svh overflow-hidden bg-[#15222b]">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-[position:58%_center]"
        style={{ backgroundImage: "url('/welcomescreen.jpg')" }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(45deg,#f8f7f2_0%,#f8f7f2_35%,rgba(248,247,242,0.9)_58%,rgba(21,34,43,0.08)_80%,rgba(21,34,43,0.28)_100%)]"
      />

      <div className="relative z-10 flex h-full items-center overflow-y-auto pl-[clamp(1.25rem,8vw,7rem)] pr-6 py-6 [align-items:safe_center]">
        <div className="w-full max-w-xl">
          <div className="flex max-w-md flex-col items-start">
            <Image
              src="/logo-crt.png"
              alt="CRT"
              width={256}
              height={273}
              priority
              className="mb-[clamp(1.5rem,6vh,4rem)] h-auto w-20 object-contain object-left"
            />

            <p className="mb-[clamp(0.75rem,2vh,1.25rem)] text-xs font-semibold text-[#b91c1c] uppercase">
              Scan · Validate · Print
            </p>
            <h1 className="max-w-lg text-[clamp(2.25rem,4vw+1.5vh,3.75rem)] leading-[0.98] font-semibold text-[#15222b]">
              Setiap box rapi sejak scan pertama.
            </h1>
            <p className="mt-[clamp(1rem,2.5vh,1.75rem)] max-w-md text-lg leading-7 text-[#46545e]">
              Satu workspace untuk memastikan label, isi box, dan proses cetak
              tetap berada di jalur yang sama.
            </p>

            <div className="mt-[clamp(1.25rem,3vh,2.5rem)] flex flex-wrap items-center gap-5">
              <Button
                asChild
                className="h-11 rounded-full bg-[#b91c1c] px-6 text-sm font-semibold text-[#fffaf7] shadow-[0_10px_24px_-12px_rgba(185,28,28,0.85)] hover:bg-[#991b1b]"
              >
                <Link href="/login">Masuk ke workspace</Link>
              </Button>
              <span className="text-sm font-medium text-[#46545e]">
                Akses sesuai role Anda
              </span>
            </div>
          </div>

          <div className="mt-[clamp(1.5rem,4vh,3rem)] flex max-w-md items-center gap-4 border-t border-[#15222b]/15 pt-5 text-xs font-medium text-[#46545e] uppercase">
            <span>CRT Label Box</span>
            <span
              aria-hidden="true"
              className="h-1 w-1 rounded-full bg-[#b91c1c]"
            />
            <span>Production Control</span>
          </div>
        </div>
      </div>
    </main>
  )
}
