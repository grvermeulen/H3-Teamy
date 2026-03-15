## Learned User Preferences

- Use `Sentry.captureException(error)` in catch blocks where exceptions are handled.
- Instrument meaningful UI and API operations with `Sentry.startSpan`, including relevant attributes.
- Import Sentry as `import * as Sentry from "@sentry/nextjs"` when using Sentry features.
- When doing test coverage analysis, only use tests listed in `enabled_tests.txt`, use the OpenAPI spec for scope, and follow `coverage_report.md` format exactly.
- GitHub CLI usage is allowed for GitHub-related tasks.

## Learned Workspace Facts

- The repository root contains a Next.js app and the primary technical docs live under `docs/`.
- Cursor Cloud setup and troubleshooting guidance is documented in `docs/cursor-cloud-setup.md`.
