## Learned User Preferences

- CodeRabbit docstring coverage is configured in `.coderabbit.yaml` (threshold **80%**); add JSDoc on exported `src/**/*.ts(x)` symbols and use CodeRabbit “Generate docstrings” when needed.
- Use GitHub CLI for GitHub actions (PRs, checks, comments, merges) when possible.
- Use the `loop-on-ci` workflow when asked: watch CI, inspect failures, apply focused fixes, and iterate until green. Also check for unresolved review comments (CodeRabbit, Cursor bot) and address them before considering the loop complete; **after implementing those fixes, resolve the matching PR review threads** (e.g. GitHub GraphQL `resolveReviewThread` with `gh api graphql`) so the PR clearly shows the work as done.
- When syncing Vercel environment configuration, treat remote settings as source of truth and sync local values from remote.
- Use the GitHub CLI when GitHub information is needed.
- Follow the provided Sentry instrumentation patterns for Next.js projects.
- For test coverage analysis, use only tests listed in `enabled_tests.txt` and format reports like `coverage_report.md`.
- Run a de-slop pass after AI-assisted implementation to remove narration comments, defensive checks the type system already covers, and tests that test the language rather than business logic.
- Research existing solutions in `src/lib/` and npm before writing new utilities or helpers.
- Run the verification loop (build, typecheck, lint, test, security scan, diff review) before creating or updating PRs.
- **Geen BugBot Pro**: gebruik de gratis stack — CodeRabbit op PRs, Agentic CI, GitHub Copilot-review (workflow), en `.cursor/rules` / `AGENTS.md` in Cursor. BugBot betaalde tier niet nodig.
- **Sentry**: project-slug is `h3-teamy`. De **organisatie-slug** in Sentry (URL: `sentry.io/organizations/<org>/…`) moet overeenkomen met `org` in `next.config.js` en `SENTRY_ORG` in `.github/workflows/sentry-issue-sync.yml`. Token `SENTRY_AUTH_TOKEN` lokaal in `.env` / `.env.local` houden; naar **Vercel** en **GitHub repo secret** zetten (niet committen).
- **Vercel Rolling Releases**: niet gebruiken zonder Pro-plan; gewone production deploys blijven voldoende.

## Learned Workspace Facts

- This repository is `H3-Teamy`, hosted at `grvermeulen/H3-Teamy`.
- The project is a Next.js 16 TypeScript app with Prisma (PostgreSQL), NextAuth, Tailwind CSS, Sentry, and Vitest.
- CI includes an "Agentic CI" verify pipeline (lint, typecheck, build, test) and Vercel deployment checks.
- Technical documentation is organized under `docs/tech/*`.
- Pull request #54 requires `AGENTS.md` to only contain learned preferences and learned workspace facts.
- All user-facing strings must be in Dutch (NL).
- Business logic belongs in `src/lib/services/` and `src/lib/*.ts`, not in API routes or components.
- API routes should be thin handlers: parse request, check auth via `getServerSession(authOptions)`, validate with Zod, delegate to service, return response.
- Shared utilities live in `src/lib/` — `userUtils.ts` (display names), `badges.ts` (attendance badges), `kv.ts` (Redis cache), `eventId.ts` (date-based IDs), `training.ts` (training logic).
- Validation schemas live in `src/lib/schemas/`.
- External services: OpenAI (report generation/vision), WaAPI (WhatsApp), Resend (email), Sportlink (iCal events), OCR worker (FastAPI/EasyOCR).
- Cache (ioredis) failures must never propagate to the caller — wrap in try/catch, log with Sentry, continue.
- Pre-commit hooks run Prettier, ESLint, `tsc --noEmit`, and `vitest run`.
- The `.cursor/rules/` directory contains agent-agnostic coding rules adapted from ECC (everything-claude-code) covering: security, API design, frontend/backend patterns, database migrations, verification loops, search-first workflow, code review, and de-slop cleanup.
