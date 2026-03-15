# Cursor automation for Vercel deployment failures

This repository now has a GitHub Actions workflow (`Vercel Deployment Failure Monitor`) that fails when Vercel reports a failed deployment status.

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
