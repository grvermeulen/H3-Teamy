# Cursor automation for Vercel deployment failures

This repository has a GitHub Actions workflow (`Vercel Deployment Failure Monitor`) that fails when Vercel reports a failed deployment status.

## Vercel build requirements

For the Next.js app to build on Vercel:

- **DATABASE_URL** must be set in **Vercel Project Settings → Environment Variables** for the **Build** phase (Production and Preview).  
  Prisma runs `prisma generate` in `postinstall`; the schema uses `env("DATABASE_URL")`, so the build fails with "Environment variable not found: DATABASE_URL" if it is missing.  
  For Preview deployments you can use the same production URL or a dedicated preview DB URL.

- Optional: **PRISMA_DATABASE_URL** is used by the app at runtime if set; build only needs **DATABASE_URL**.

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
