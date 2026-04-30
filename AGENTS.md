## Learned User Preferences

- CodeRabbit docstring coverage is configured in `.coderabbit.yaml` (threshold **80%**); add JSDoc on exported `src/**/*.ts(x)` symbols and use CodeRabbit "Generate docstrings" when needed.
- Use GitHub CLI for GitHub actions (PRs, checks, comments, merges) when possible.
- Use the `loop-on-ci` workflow when asked: watch CI, inspect failures, apply focused fixes, and iterate until green. After processing CodeRabbit (and other PR bot, e.g. Cursor bot) review comments in code, also mark the corresponding GitHub review threads as **resolved** in the same CI/PR round — not as a separate later step. Use e.g. GraphQL `resolveReviewThread` via `gh api graphql` so the PR visibly looks "done".
- When syncing Vercel environment configuration, treat remote settings as source of truth and sync local values from remote.
- Use the GitHub CLI when GitHub information is needed.
- Follow the provided Sentry instrumentation patterns for Next.js projects.
- For test coverage analysis, use only tests listed in `enabled_tests.txt` and format reports like `coverage_report.md`.
- Run a de-slop pass after AI-assisted implementation to remove narration comments, defensive checks the type system already covers, and tests that test the language rather than business logic.
- Research existing solutions in `src/lib/` and npm before writing new utilities or helpers.
- Run the verification loop (build, typecheck, lint, test, security scan, diff review) before creating or updating PRs.
- **No paid BugBot tier**: use the free stack — CodeRabbit on PRs, Agentic CI, GitHub Copilot review (workflow), and `.cursor/rules` / `AGENTS.md` in Cursor.
- **Vercel Rolling Releases**: do not use without a Pro plan; regular production deploys are sufficient.

## Learned Workspace Facts

<!--
Project-specific facts go here. Fill in for the new project, e.g.:

- This repository is `<owner>/<repo>`.
- The project targets **Node.js 22**, and is a <framework> app with <stack summary>.
- CI includes an "Agentic CI" verify pipeline (lint, typecheck, build, test).
- Technical documentation is organized under `docs/tech/*`.
- Business logic belongs in `src/lib/services/` and `src/lib/*.ts`, not in API routes or components.
- API routes should be thin handlers: parse request, check auth, validate with Zod, delegate to service, return response.
- Validation schemas live in `src/lib/schemas/`.
- Sentry organization slug, project slug, and required env vars (`SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`).
- Pre-commit hooks run Prettier, ESLint, `tsc --noEmit`, and `vitest run`.
- The `.cursor/rules/` directory contains agent-agnostic coding rules covering: security, API design, frontend/backend patterns, database migrations, verification loops, search-first workflow, code review, and de-slop cleanup.
-->
