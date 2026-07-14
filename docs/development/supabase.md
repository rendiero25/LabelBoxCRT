# Supabase Development Workflow

## Tooling

- CLI is pinned in `devDependencies`; on Windows run it with `npx.cmd supabase`.
- Database development and verification use the hosted Supabase development
  project approved for LabelBoxCRT. Docker is not required for this repository.
- Browser code receives only `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Never expose service-role, secret, or QZ private keys through `NEXT_PUBLIC_`.

## Hosted development setup

```powershell
npm install
Copy-Item .env.example .env.local
npx.cmd supabase --version
npx.cmd supabase link --help
npx.cmd supabase link --project-ref <APPROVED_DEVELOPMENT_PROJECT_REF>
```

Never run `supabase db reset` against a hosted project. Use a disposable
development project or Supabase branch for destructive reset/replay work. The
production project is outside Phase 2 scope.

Before applying any migration, inspect both histories:

```powershell
npx.cmd supabase migration list --help
npx.cmd supabase migration list
npx.cmd supabase db push --help
```

Connector access may be used for read-only inspection, iterative SQL, tests,
advisors, and type generation. Only the explicitly approved LabelBoxCRT project
may be changed. Project references and credentials stay outside version control.

## Migration workflow

1. Discover current CLI flags with `npx.cmd supabase <command> --help`.
2. Inspect hosted tables, functions, advisors, and migration history.
3. Write pgTAP contract tests and observe the expected failure.
4. Create migrations using `npx.cmd supabase migration new <descriptive_name>`.
5. Iterate on the approved development target; keep migration history linear.
6. Run pgTAP tests, database lint, and security/performance advisors.
7. Generate `src/types/database.ts` from the verified hosted schema.
8. Run application typecheck, lint, unit tests, and build.
9. Commit migrations, database tests, generated types, and documentation.

Hosted Auth users are created through a protected administration path. Their
passwords never enter `seed.sql`. Phase 2 seed resolves the approved development
emails and fails clearly if either account is absent.

## Current Phase 2 target

- Project name: `Label Box`
- PostgreSQL: 17
- Initial application migrations: none
- Initial public application tables: none
- Existing platform event trigger: `ensure_rls`
- Existing security finding: `public.rls_auto_enable()` is executable by
  `PUBLIC`, `anon`, and `authenticated`; Phase 2 migration must revoke those
  execute privileges.

Do not remove the `ensure_rls` event trigger. It enables RLS defensively on new
public tables. Explicit migration statements and tests remain mandatory.

Do not hand-invent migration timestamps or use direct client-side mutations for
operations that require transactional RPC invariants.
