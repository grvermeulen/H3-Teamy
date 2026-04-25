# Cursor automation for Vercel deployment failures

This repository has a GitHub Actions workflow (`Vercel Deployment Failure Monitor`) that fails when Vercel reports a failed deployment status.

## Vercel build requirements

For the Next.js app to build on Vercel:

- **Database URL for build**: `scripts/migrate-deploy-or-skip.mjs` runs before `next build` and calls `prisma migrate deploy` when any of these is set (direct/unpooled first): **DATABASE_URL_UNPOOLED**, **POSTGRES_URL_NON_POOLING**, **DIRECT_URL**, **DATABASE_URL**, **POSTGRES_URL**, **POSTGRES_PRISMA_URL**, **PRISMA_DATABASE_URL**. If none are set, the script skips migrations so the build still succeeds (set at least one URL on Preview/Production to avoid schema drift).

- **PRISMA_DATABASE_URL** is used by the app at runtime if set (pooled URL). For migrations, prefer a **direct** URL (e.g. **DATABASE_URL_UNPOOLED** on Vercel Postgres) when the pooler rejects DDL.

## Runtime database timeouts (Sentry: connection timeout / Prisma P100x)

If Sentry shows **“Connection terminated due to connection timeout”**, **“timeout exceeded when trying to connect”**, or **`PrismaClientKnownRequestError`** on API routes, the app is usually hitting **Postgres connection limits** or **slow direct connections** from many Vercel function instances.

**Do this in Vercel (Production + Preview):**

1. Set **`PRISMA_DATABASE_URL`** to the **pooled** connection string from your host (not the direct “session” URL):
   - **Neon**: use the URL that includes `-pooler` / the pooler host, or port **6543** as documented for serverless.
   - **Supabase**: use the **Transaction pooler** (often port **6543**), not port 5432.
   - **Other**: use PgBouncer or the provider’s “serverless” / “pooled” URL.
2. Keep **`DATABASE_URL`** for Prisma CLI / migrations if your host requires a **direct** URL for `prisma migrate`; runtime traffic should prefer **`PRISMA_DATABASE_URL`** when both exist.
3. Optional tuning via env: **`PG_POOL_MAX`** (default **1** on Vercel, **10** locally), **`PG_CONNECTION_TIMEOUT_MS`** (default **20000**), **`PG_IDLE_TIMEOUT_MS`** (default **20000**).

The app uses a small **`pg` `Pool`** per instance (`src/lib/db.ts`) so connections stay bounded; without a pooled URL, cold starts can still exhaust the database.

## Common causes of Vercel deployment failure

1. **DATABASE_URL not set for Build** – See above. Fix: add the variable in Vercel dashboard for Build (all environments).
2. **Lockfile out of sync** – If `package-lock.json` is out of sync with `package.json`, `npm install` (or `npm ci` if configured) can fail. Fix: run `npm install` locally and commit the updated lockfile.
3. **Node version** – Vercel defaults may vary by project/runtime; this repo targets Node 22. If needed, set it in Project Settings or a root `vercel.json` with `"engines": { "node": "22" }`.
4. **Build memory/time** – Large Prisma schemas or heavy build steps can hit limits. Consider reducing build-time work or upgrading plan.

Use Cursor Automations to react to that failure automatically:

1. Go to `cursor.com/automations/new`.
2. Trigger: **CI completed**.
3. Repository: `grvermeulen/H3-Teamy`.
4. Filter on workflow name: `Vercel Deployment Failure Monitor`.
5. Run only when the CI conclusion is **failed**.
6. Use this prompt:

```text
Investigate the failed Vercel deployment for this run.
- Identify the failing commit SHA and branch.
- Inspect deployment status context, changed files, and recent dependency updates.
- Reproduce the failure locally with the same build command.
- Propose and implement the smallest safe fix.
- Run lint/build/tests relevant to the change.
- Open a concise summary with root cause, fix, and verification steps.
```

This gives you a fully automated triage loop whenever a new Vercel deployment fails.
