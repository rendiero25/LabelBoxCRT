# Phase 3.1 Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver password login, logout, active-account verification, and authenticated route protection for the operator and admin surfaces.

**Architecture:** Supabase Auth owns the browser session. Server Components and Server Actions call `auth.getClaims()` to verify the JWT, then read the caller's own `profiles` record to establish active status. The proxy only refreshes cookies; it does not authorize routes. Protected layouts redirect unauthenticated, expired, missing-profile, and inactive sessions to `/login` with a safe reason code.

**Tech Stack:** Next.js 16 App Router, React 19 Server Actions, TypeScript strict, `@supabase/ssr`, Supabase PostgreSQL/RLS, shadcn/ui, Vitest, pgTAP.

## Global Constraints

- Use the existing npm package manager; do not add a package for this phase.
- Verify server identity with `supabase.auth.getClaims()`; never use `getSession()` as an authorization decision.
- Roles remain `admin` and `operator`; Phase 3.2 will add role-specific guards.
- Keep password and token values out of logs and UI error detail.
- An inactive user may read only their own `is_active` state, then must be signed out and denied all protected application data.
- Preserve shadcn semantic tokens, Field, Alert, Button, Input, Spinner, and Sonner patterns.

---

### Task 1: Establish auth contract and inactive-profile RLS exception

**Files:**

- Create: `src/features/auth/credentials.test.ts`
- Create: `src/features/auth/credentials.ts`
- Create: `supabase/tests/004_phase_3_auth_rls.test.sql`
- Create: `supabase/migrations/<timestamp>_phase_3_auth_profile_self_visibility.sql`

**Interfaces:**

- `parseCredentials(values): { credentials?: { email: string; password: string }; error?: string }`
- `getAuthNotice(reason?: string): string | null`

- [ ] Write failing tests for email normalization, blank credentials, and safe auth notices.
- [ ] Run `npm.cmd test -- src/features/auth/credentials.test.ts` and confirm it fails before implementation.
- [ ] Implement the contract and change `profiles_select` so a user can only read their own profile regardless of `is_active`; admins retain full access.
- [ ] Apply the remote migration and run unit plus pgTAP tests.
- [ ] Commit `feat: define authenticated profile contract`.

### Task 2: Implement verified server auth and actions

**Files:**

- Create: `src/features/auth/server.ts`
- Create: `src/app/(auth)/login/actions.ts`

**Interfaces:**

- `getVerifiedAuthContext(): Promise<AuthContext>` calls `auth.getClaims()` and selects `id, email, full_name, role, is_active` by claimed subject.
- `requireActiveUser(): Promise<ActiveAuthContext>` redirects invalid states to `/login`.
- `signInAction(previousState, formData)` uses `signInWithPassword` and returns only safe error messages.
- `signOutAction()` ends the local session and redirects to `/login?reason=signed-out`.

- [ ] Extend failing auth-notice test for expiry and unknown reasons.
- [ ] Run the focused test and confirm it fails.
- [ ] Implement the server helpers and actions without logging credentials or trusting `getSession()`.
- [ ] Run focused unit tests and `npm.cmd run typecheck`.
- [ ] Commit `feat: verify active auth sessions on the server`.

### Task 3: Build UI and protect layouts

**Files:**

- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/features/auth/components/login-form.tsx`
- Create: `src/features/auth/components/sign-out-button.tsx`
- Modify: `src/app/(operator)/scan/layout.tsx`
- Modify: `src/app/admin/layout.tsx`

**Interfaces:**

- Login form consumes `signInAction` and uses existing Field, Alert, Button, Input, and Spinner components.
- Layouts call `requireActiveUser` before rendering and expose a POST logout control.

- [ ] Extend the failing auth-notice test for signed-out and unauthorized messages.
- [ ] Run the focused test and confirm it fails.
- [ ] Implement the accessible login form, notice state, error state, pending state, logout control, and server guards.
- [ ] Run focused unit tests, lint, typecheck, and inspect `/login?reason=signed-out` in a browser.
- [ ] Commit `feat: add protected authentication flow`.

### Task 4: Verify and document completion

**Files:**

- Modify: `task.md`
- Create: `docs/phase-3/phase-3-1-verification.md`

- [ ] Mark exactly the six Phase 3.1 checkboxes complete only after all evidence exists.
- [ ] Run `npm.cmd test`, `npm.cmd run test:integration`, `npm.cmd run lint`, `npm.cmd run typecheck`, and `npm.cmd run build`.
- [ ] Run the hosted pgTAP database suite and Supabase security advisor; record results.
- [ ] Commit `docs: verify phase 3 authentication`.

## Self-Review

- Spec coverage: Tasks 1-3 cover login, logout, protected routes, server verification, inactive handling, and session-expiry handling. Phase 3.2 roles and Phase 3.3 workstation work remain out of scope.
- Type consistency: `parseCredentials`, `getAuthNotice`, `getVerifiedAuthContext`, `requireActiveUser`, `signInAction`, and `signOutAction` are the exact interfaces used across tasks.
