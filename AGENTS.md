## Learned User Preferences

- CodeRabbit docstring coverage is configured in `.coderabbit.yaml` (threshold **80%**); add JSDoc on exported `src/**/*.ts(x)` symbols and use CodeRabbit “Generate docstrings” when needed.
- Use GitHub CLI for GitHub actions (PRs, checks, comments, merges) when possible.
- Use the `loop-on-ci` workflow when asked: watch CI, inspect failures, apply focused fixes, and iterate until green. Voor **CodeRabbit** (en andere PR-bots zoals Cursor bot): na het verwerken van review-opmerkingen in code moeten de bijbehorende **GitHub-reviewthreads ook op resolved gezet worden** — dat hoort bij dezelfde CI/PR-ronde, niet als aparte stap later. Gebruik bijv. GraphQL `resolveReviewThread` met `gh api graphql` zodat de PR zichtbaar “af” is.
- When syncing Vercel environment configuration, treat remote settings as source of truth and sync local values from remote.
- Use the GitHub CLI when GitHub information is needed.
- Follow the provided Sentry instrumentation patterns for Next.js projects.
- For test coverage analysis, use only tests listed in `enabled_tests.txt` and format reports like `coverage_report.md`.
- Run a de-slop pass after AI-assisted implementation to remove narration comments, defensive checks the type system already covers, and tests that test the language rather than business logic.
- Research existing solutions in `src/lib/` and npm before writing new utilities or helpers.
- Run the verification loop (build, typecheck, lint, test, security scan, diff review) before creating or updating PRs.
- **Geen BugBot Pro**: gebruik de gratis stack — CodeRabbit op PRs, Agentic CI, GitHub Copilot-review (workflow), en `.cursor/rules` / `AGENTS.md` in Cursor. BugBot betaalde tier niet nodig.
- **Sentry**: organisatie-slug is `h3-teamy`; **project-slug** in Sentry is `javascript-nextjs` (Project → Settings → General). Dat moet overeenkomen met `org` / `project` in `next.config.js` en `SENTRY_ORG` / `SENTRY_PROJECT` in `.github/workflows/sentry-issue-sync.yml`. Optioneel `SENTRY_PROJECT` in Vercel zetten om te overrulen. Token `SENTRY_AUTH_TOKEN` lokaal in `.env` / `.env.local` houden; naar **Vercel** en **GitHub repo secret** zetten (niet committen).
- **Vercel Rolling Releases**: niet gebruiken zonder Pro-plan; gewone production deploys blijven voldoende.

## Learned Workspace Facts

- This repository is `H3-Teamy`, hosted at `grvermeulen/H3-Teamy`.
- The project targets **Node.js 22** (`package.json` `engines`), and is a Next.js 16 app with React 19, TypeScript 6, Prisma 5 (PostgreSQL), NextAuth, Tailwind CSS 4, Sentry, and Vitest.
- CI includes an "Agentic CI" verify pipeline (lint, typecheck, build, test) and Vercel deployment checks.
- Technical documentation is organized under `docs/tech/*`.
- Pull request #54 requires `AGENTS.md` to only contain learned preferences and learned workspace facts.
- All user-facing strings must be in Dutch (NL).
- Business logic belongs in `src/lib/services/` and `src/lib/*.ts`, not in API routes or components.
- API routes should be thin handlers: parse request, check auth via `getServerSession(authOptions)`, validate with Zod, delegate to service, return response.
- Shared utilities live in `src/lib/` — `userUtils.ts` (display names), `badges.ts` (attendance badges), `kv.ts` (Redis cache), `eventId.ts` (date-based IDs), `training.ts` (training logic).
- Validation schemas live in `src/lib/schemas/`.
- External services: OpenAI/Anthropic via the Vercel AI Gateway (report generation/vision, idea triage), WaAPI (WhatsApp), Resend (email), Sportlink (iCal events), OCR worker (FastAPI/EasyOCR).
- All AI calls go through `src/lib/ai/client.ts`, which wraps the Vercel AI SDK v6 with Braintrust tracing. Env vars: `BRAINTRUST_API_KEY` enables tracing (no-op when absent), `BRAINTRUST_PROJECT_NAME` (default `"H3-Teamy"`). Run `npm run eval` to execute Braintrust evals in `evals/`.
- Cache (ioredis) failures must never propagate to the caller — wrap in try/catch, log with Sentry, continue.
- Pre-commit hooks run Prettier, ESLint, `tsc --noEmit`, and `vitest run`.
- The `.cursor/rules/` directory contains agent-agnostic coding rules adapted from ECC (everything-claude-code) covering: security, API design, frontend/backend patterns, database migrations, verification loops, search-first workflow, code review, and de-slop cleanup.
