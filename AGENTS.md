## Learned User Preferences

- Use GitHub CLI for GitHub actions (PRs, checks, comments, merges) when possible.
- Use the `loop-on-ci` workflow when asked: watch CI, inspect failures, apply focused fixes, and iterate until green.
- Resolve CodeRabbit review comments once the underlying fix is implemented.
- When syncing Vercel environment configuration, treat remote settings as source of truth and sync local values from remote.

## Learned Workspace Facts

- The project is a Next.js TypeScript app with Prisma and Vitest-based testing.
- CI includes an "Agentic CI" verify pipeline (lint, typecheck, build, test) and Vercel deployment checks.
