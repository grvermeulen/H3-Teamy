# Team Rules (Always)

These rules are always attached to the model context for this repo.

## Coding standards

- Prefer descriptive, full-word names; avoid 1–2 character identifiers (e.g. `d`, `y`, `m` → `dayOfMonth`, `year`, `month`).
- Use guard clauses and avoid deep nesting.
- Keep comments minimal and only for non-obvious rationale or caveats. Never trace implementation steps in comments inside tests.
- Match existing formatting; prefer multi-line over dense one-liners.
- Maintain type safety in TypeScript; avoid `any` and unsafe casts.
  - Use `vi.mocked(fn)` — never `(fn as any)` — when typing Vitest mocks.
  - Use `catch (err: unknown)` — never `catch (err: any)`.
  - Declare explicit return types on all exported functions.
  - Use `const list: Foo[] = []` — never `const list = [] as Foo[]`.
- For `**/*.{ts,tsx}`: all exported functions, classes, and components must include JSDoc (`/** ... */`).
- Maintain at least 80% docstring coverage.

## Commit rules

- Follow Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `perf:`, `build:`, `ci:`.
- Keep subject ≤72 chars; use imperative mood.
- Reference issues in the body when relevant (e.g., `Closes #123`).
- Never commit debug/development-only comments into source (e.g. `// CI: trigger AI review`).

## Test norms

- Co-locate tests next to source or in a `__tests__` folder.
- Aim for fast unit tests, focused integration tests, and minimal E2E smoke.
- For regressions, add a failing test first.
- Ensure CI runs `npm run lint` and `tsc --noEmit` at minimum on PRs.
- Every describe block using mocks needs `beforeEach(() => { vi.clearAllMocks(); })`.
- Use `vi.stubEnv` / `vi.unstubAllEnvs` for environment variables — never raw `process.env` assignment.
- Never call `fireEvent` / `userEvent` inside a `waitFor` callback.
- Never use bare date-only strings in tests (e.g. `"2023-01-01"`) — use `"2023-01-01T12:00:00"` to avoid UTC-vs-local failures on CI.

## Sentry usage (Next.js)

- Import Sentry via `import * as Sentry from "@sentry/nextjs"`.
- Capture exceptions with `Sentry.captureException(error)` in try/catch or error boundaries.
- Every `catch` block in production code must call `Sentry.captureException(error)` or re-throw. Silent `catch (() => {})` is forbidden.
- Cache writes (KV store, etc.) must never propagate their errors to the caller — wrap in try/catch, log with Sentry, and continue.
- Error boundaries must call `Sentry.captureException(error)` inside their `useEffect`.
- Tracing: instrument meaningful actions using `Sentry.startSpan({ op, name }, (span) => { ... })` and attach `span.setAttribute(...)` for key metrics.
- Logging: enable logs with `Sentry.init({ _experiments: { enableLogs: true } })` (in `instrumentation-client.ts` / server config files). Use `const { logger } = Sentry`.
- Use `Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] })` when appropriate.

## Pull request quality gates

- All PRs must pass lint and type checks.
- High-risk changes should include test updates and Sentry instrumentation when applicable.
- AI review must run and pass before merge when the status check is required.
- When a CodeRabbit review comment is fixed in code, resolve that review thread immediately.
- All user-facing strings must be in Dutch (NL) — no English UI copy.
- No inline `style` props — use Tailwind utility classes exclusively.
- Component names must not shadow global constructors (`Error`, `Promise`, etc.).

## CI rules

- Use Node 20 or 22 in all workflow files. Node 18 is EOL.
- Every workflow job must declare an explicit `permissions` block (minimum `contents: read`).
- Add a `concurrency` group to workflows triggered on both `push` and `pull_request` to prevent duplicate runs.
- Full test suite runs belong in `pre-push`, not `pre-commit`. Use `--changed` flag when running on commit.
