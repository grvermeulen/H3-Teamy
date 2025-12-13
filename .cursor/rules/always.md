# Team Rules (Always)

These rules are always attached to the model context for this repo.

## Coding standards

- Prefer descriptive, full-word names; avoid 1–2 character identifiers.
- Use guard clauses and avoid deep nesting.
- Keep comments minimal and only for non-obvious rationale or caveats.
- Match existing formatting; prefer multi-line over dense one-liners.
- Maintain type safety in TypeScript; avoid `any` and unsafe casts.

## Commit rules

- Follow Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `perf:`, `build:`, `ci:`.
- Keep subject ≤72 chars; use imperative mood.
- Reference issues in the body when relevant (e.g., `Closes #123`).
- always create a new branch when starting a new feature

## Test norms

- Always run a local compilation first before pushing
- Co-locate tests next to source or in a `__tests__` folder.
- Aim for fast unit tests, focused integration tests, and minimal E2E smoke.
- For regressions, add a failing test first.
- Ensure CI runs `npm run lint` and `tsc --noEmit` at minimum on PRs.

## Sentry usage (Next.js)

- Import Sentry via `import * as Sentry from "@sentry/nextjs"`.
- Capture exceptions with `Sentry.captureException(error)` in try/catch or error boundaries.
- Tracing: instrument meaningful actions using `Sentry.startSpan({ op, name }, (span) => { ... })` and attach `span.setAttribute(...)` for key metrics.
- Logging: enable logs with `Sentry.init({ _experiments: { enableLogs: true } })` (in `instrumentation-client.ts` / server config files). Use `const { logger } = Sentry`.
- Use `Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] })` when appropriate.

## Pull request quality gates

- All PRs must pass lint and type checks.
- High-risk changes should include test updates and Sentry instrumentation when applicable.
- AI review must run and pass before merge when the status check is required.
