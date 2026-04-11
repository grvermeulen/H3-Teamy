# Copilot Coding Agent Instructions

This repository is **H3-Teamy** (`grvermeulen/H3-Teamy`), a Next.js 16 TypeScript
app with Prisma (PostgreSQL), NextAuth, Tailwind CSS, Sentry, and Vitest.

## Conventions

- All user-facing strings must be in **Dutch (NL)**.
- Business logic belongs in `src/lib/services/` and `src/lib/*.ts`, not in API routes or components.
- API routes should be thin handlers: parse request, check auth via `getServerSession(authOptions)`, validate with Zod, delegate to service, return response.
- Validation schemas live in `src/lib/schemas/`.
- Add JSDoc on all exported functions, hooks, types, and React components.
- Run a de-slop pass: remove narration comments, redundant defensive checks, and tests that test the language rather than business logic.

## Project Structure

- `src/app/` — Next.js App Router pages and API routes
- `src/components/` — React components
- `src/lib/` — Shared utilities, services, schemas
- `prisma/` — Prisma schema and migrations
- `.cursor/rules/` — Detailed coding rules (security, API design, frontend/backend patterns, database migrations, verification loops)

## Install & Build

```bash
npm ci --legacy-peer-deps --ignore-scripts
npx prisma generate
npm run build
```

## Testing

```bash
npx vitest run
```

## Pre-commit Checks

Husky pre-commit hooks run: Prettier, ESLint, `tsc --noEmit`, and `vitest run`.

## Key Rules

- Cache (ioredis) failures must never propagate — wrap in try/catch, log with Sentry, continue.
- Use `Sentry.captureException(error)` in catch blocks. Use `Sentry.startSpan` for meaningful actions.
- Research existing solutions in `src/lib/` and npm before writing new utilities.
- Run the verification loop (build, typecheck, lint, test) before submitting changes.
