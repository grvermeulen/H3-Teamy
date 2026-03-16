## Learned User Preferences

- Use GitHub CLI for GitHub actions (PRs, checks, comments, merges) when possible.
- Use the `loop-on-ci` workflow when asked: watch CI, inspect failures, apply focused fixes, and iterate until green.
- Resolve CodeRabbit review comments once the underlying fix is implemented.
- When syncing Vercel environment configuration, treat remote settings as source of truth and sync local values from remote.
- Use the GitHub CLI when GitHub information is needed.
- Follow the provided Sentry instrumentation patterns for Next.js projects.
- For test coverage analysis, use only tests listed in `enabled_tests.txt` and format reports like `coverage_report.md`.

## Learned Workspace Facts

- This repository is `H3-Teamy`.
- Technical documentation is organized under `docs/tech/*`.
- Pull request #54 requires `AGENTS.md` to only contain learned preferences and learned workspace facts.
- The project is a Next.js TypeScript app with Prisma and Vitest-based testing.
- CI includes an "Agentic CI" verify pipeline (lint, typecheck, build, test) and Vercel deployment checks.
