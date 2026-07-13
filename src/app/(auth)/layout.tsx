export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="bg-muted/30 flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-md">{children}</div>
    </main>
  )
}
