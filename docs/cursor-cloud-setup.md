# Cursor Cloud local setup

## Services overview

H3-Teamy is a Next.js 16 (App Router / Turbopack) web app for managing a Dutch waterpolo team. The primary local service is the Next.js dev server on port 3000. PostgreSQL is required for database-backed features such as authentication, RSVP, and attendance.

## Running the app locally

1. Start PostgreSQL (cluster 16).
2. Start the Next.js dev server with `npm run dev`.

## Database notes

- PostgreSQL 16 is expected for local development.
- Set `DATABASE_URL` in `.env` to your local database connection string.
- After installing dependencies, run `npx prisma generate` (without `--accelerate`) and `npx prisma db push` to sync the schema.
- The repository `postinstall` script runs `prisma generate --accelerate`, which can fail locally; if needed, install with `npm install --legacy-peer-deps --ignore-scripts` and run Prisma generation manually.

## Known local dependency issues

- Prisma version mismatch can happen if `prisma` and `@prisma/client` major versions diverge; keep them aligned to the same major and preferably same version.
- `@asteasolutions/zod-to-openapi` may require a different Zod major version than the app currently uses; use `--legacy-peer-deps` when needed for local installs.
- `eslint` major-version mismatches with `eslint-config-next` can break `npm run lint`.
- `react` and `react-dom` major-version mismatches can break component test runtime.

## Lint, test, and build

- Lint: `npm run lint`
- Type check: `npx tsc --noEmit`
- Tests: `npx vitest run`
- Build: `npm run build`
- Format check: `npm run format`

## Environment variables

For basic local development, configure `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL`. For optional integrations and extended environment variables, see `.cursor/rules/always.md`.
