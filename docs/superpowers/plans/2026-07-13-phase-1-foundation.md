# Phase 1 Project Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a verified Next.js foundation with strict TypeScript, pinned npm dependencies, Supabase SSR clients, shadcn components, semantic CRT tokens, and minimal auth/operator/admin shells.

**Architecture:** A Next.js 16 App Router application lives under `src/`. Supabase access is isolated in `src/lib/supabase`, generated database types in `src/types`, and layouts are separated by route responsibility. Phase 1 contains no business schema or scan/print implementation.

**Tech Stack:** Node 24.6.0, npm, Next.js 16.2.10, React 19.2.7, TypeScript 6.0.3 strict, ESLint 9.39.5, Tailwind CSS 4.3.2, shadcn 4.13.0, Supabase JS 2.110.2, `@supabase/ssr` 0.12.0, Vitest 4.1.10, Playwright 1.61.1.

## Global Constraints

- Use npm only and commit `package-lock.json`.
- Pin exact dependency versions.
- Keep service-role and QZ private keys out of browser code and repository.
- Use App Router, `src/`, alias `@/*`, semantic shadcn tokens, and Outfit.
- Do not implement Phase 2 schema, RLS, scan, or printing behavior.

---

### Task 1: Repository and toolchain

**Files:** Create `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `.env.example`, `vitest.config.ts`, `playwright.config.ts`; modify `docs/phase-0/*`.

**Interfaces:** Produces npm scripts `dev`, `build`, `start`, `lint`, `format`, `format:check`, `typecheck`, `test`, `test:watch`, `test:integration`, and `test:e2e`.

- [ ] Initialize Git on branch `phase-1-foundation` and add the empty GitHub remote.
- [ ] Create exact dependency manifest and install with npm to generate the lockfile.
- [ ] Configure strict TypeScript, ESLint, Prettier, Vitest, and Playwright.
- [ ] Verify configuration with `npm run typecheck` after source scaffolding exists.

### Task 2: Supabase SSR boundary

**Files:** Create `src/lib/env/public.ts`, `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/proxy.ts`, `src/proxy.ts`, `src/types/database.ts`, `supabase/config.toml`, `docs/development/supabase.md`; test `src/lib/env/public.test.ts`.

**Interfaces:** Produces `getPublicSupabaseEnv()`, `createClient()` for browser/server, and `updateSession(request)` for Next.js proxy.

- [ ] Write a failing test proving missing public Supabase variables return a typed configuration error.
- [ ] Implement minimal environment validation and make the test pass.
- [ ] Implement browser/server clients using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- [ ] Implement the current Supabase SSR proxy cookie pattern and validate identity with `getClaims()` rather than trusting `getSession()` alone.
- [ ] Add placeholder generated `Database` type and document the exact future `supabase gen types` workflow.

### Task 3: shadcn and semantic theme

**Files:** Create `components.json`, `src/app/globals.css`, `src/lib/utils.ts`, and shadcn sources under `src/components/ui/`.

**Interfaces:** Produces reusable Button, Field, Input, Select, Table, Badge, Alert, Dialog, AlertDialog, Sheet, Sidebar, Progress, Skeleton, Spinner, Empty, Sonner, and Tooltip components.

- [ ] Initialize shadcn with the npm runner and inspect `shadcn info`.
- [ ] Fetch component docs, then add the required Phase 1 component set through the CLI.
- [ ] Apply accessible CRT-derived semantic tokens and reduced-motion CSS.
- [ ] Review generated sources for composition, icon, and semantic-color rules.

### Task 4: Minimal application shells

**Files:** Create `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/error.tsx`, `src/app/not-found.tsx`, `src/app/loading.tsx`, `src/app/(auth)/layout.tsx`, `src/app/(operator)/scan/layout.tsx`, `src/app/(operator)/scan/page.tsx`, `src/app/admin/layout.tsx`, `src/app/admin/page.tsx`, `src/components/shared/app-status.tsx`, `src/components/shared/app-status.test.tsx`, and `public/logo-crt.png`.

**Interfaces:** Produces accessible route shells and a `Toaster` provider; no authenticated behavior is implied.

- [ ] Write a failing component test for the three foundation status labels.
- [ ] Implement the smallest shared status component and make the test pass.
- [ ] Add root, auth, operator, and admin layouts with distinct responsibilities.
- [ ] Add global error, not-found, loading, toast, and reduced-motion support.

### Task 5: Verification and documentation

**Files:** Modify `README.md`, `task.md`, and this plan.

**Interfaces:** Produces a reproducible Phase 1 handoff.

- [ ] Run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
- [ ] Run `npx shadcn@4.13.0 info` and inspect the final component list.
- [ ] Scan source and build output for service-role/private-key material.
- [ ] Check only evidence-backed Phase 1 items in `task.md`; document Docker as an external prerequisite if unavailable.
