# Supabase Development Workflow

## Tooling

- CLI is pinned in `devDependencies`; run it with `npx supabase`.
- Docker Desktop is required to start the local stack but was not installed on
  the Phase 1 workstation.
- Browser code receives only `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Never expose service-role, secret, or QZ private keys through `NEXT_PUBLIC_`.

## Local setup

```powershell
npm install
Copy-Item .env.example .env.local
npx supabase start
```

After Phase 2 migrations exist:

```powershell
npx supabase db reset
npx supabase gen types typescript --local > src/types/database.ts
npx supabase migration list --local
```

The generated types command is intentionally not run in Phase 1 because no
application schema exists yet. Replace the placeholder type only after a clean
database reset successfully applies all migrations.

## Migration workflow

1. Discover current CLI flags with `npx supabase <command> --help`.
2. Create migrations using `npx supabase migration new <descriptive_name>`.
3. Apply from a clean local database with `npx supabase db reset`.
4. Run database tests and advisors.
5. Generate `src/types/database.ts` from the verified schema.
6. Commit migrations, database tests, generated types, and lockfile together.

Do not hand-invent migration timestamps or use direct client-side mutations for
operations that require transactional RPC invariants.
