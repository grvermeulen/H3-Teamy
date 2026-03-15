## Cursor Cloud specific instructions

### Services overview

**H3-Teamy** is a Next.js 16 (App Router / Turbopack) web app for managing a Dutch waterpolo team. The single required service is the Next.js dev server (`npm run dev`, port 3000). PostgreSQL is required for database-backed features (auth, RSVP, attendance).

### Running the app

1. Start PostgreSQL: `sudo pg_ctlcluster 16 main start`
2. Start Next.js dev server: `npm run dev` (port 3000)

### Database

- PostgreSQL 16 is installed. User `h3team` / password `h3team`, database `h3teamy`.
- Connection string in `.env`: `DATABASE_URL="postgresql://h3team:h3team@localhost:5432/h3teamy"`
- After installing deps, run `npx prisma generate` (without `--accelerate`) then `npx prisma db push` to sync the schema.
- The `postinstall` script runs `prisma generate --accelerate` which fails locally; use `npm install --legacy-peer-deps --ignore-scripts` then `npx prisma generate` separately.

### Known dependency issues

- **Prisma version mismatch**: `package.json` declares `prisma@5.19.1` and `@prisma/client@7.5.0`. These are incompatible; install both at `5.19.1` for local dev: `npm install prisma@5.19.1 @prisma/client@5.19.1 --legacy-peer-deps`.
- **Peer dependency conflict**: `@asteasolutions/zod-to-openapi@8.4.3` requires `zod@^4.0.0` but the project uses `zod@^3.25.76`. Use `--legacy-peer-deps` flag with `npm install`.
- **ESLint**: `eslint@10` + `eslint-config-next@16.1.6` has a compatibility issue with the bundled `eslint-plugin-react`. `npm run lint` crashes with `getFilename is not a function`. This is a pre-existing issue.
- **React/React-DOM mismatch**: `react@18.3.1` and `react-dom@19.2.4` cause 2 component test suites (`ReportPreview.test.tsx`, `MvpVoteButton.test.tsx`) to fail to load. All 52 unit tests in the other 8 suites pass.

### Lint / Test / Build

- Lint: `npm run lint` (currently broken, see above)
- Type check: `npx tsc --noEmit` (passes)
- Tests: `npx vitest run` (52/52 tests pass; 2 component suites fail due to react version mismatch)
- Build: `npm run build`
- Format: `npm run format` (Prettier check)

### Environment variables

Only `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL` are required for basic local dev. See `.cursor/rules/always.md` for the full list of optional env vars (OpenAI, Redis, WaAPI, etc.).
