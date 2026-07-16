export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
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

      <div className="relative z-10 flex h-full items-end pl-[clamp(2rem,8vw,7rem)] pr-6 pb-[clamp(2rem,8vw,7rem)]">
        <div className="w-full max-w-md animate-in fade-in-0 slide-in-from-bottom-4 duration-700 ease-out motion-reduce:animate-none">
          {children}
        </div>
      </div>
    </main>
  )
}
