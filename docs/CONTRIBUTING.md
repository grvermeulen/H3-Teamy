# Docs Contribution Guide

## CodeRabbit & docstrings (min. 80%)

- Het repository bevat [`.coderabbit.yaml`](../.coderabbit.yaml) met **pre-merge docstring coverage**: drempel **80%**, modus **warning** (zichtbaar in de PR-check totdat de dekking klopt).
- **Geëxporteerde** functies, hooks, types en componenten in `src/**/*.{ts,tsx}`: voorzie van zinvolle JSDoc (`/** ... */`), liefst met `@param` / `@returns` waar dat helpt.
- Ontbreekt er documentatie: gebruik in de PR walkthrough **Generate docstrings** of het commando `@coderabbitai generate docstrings` (zie [CodeRabbit docstrings](https://docs.coderabbit.ai/finishing-touches/docstrings/)).

## API & feature docs

- Every API route must include either Zod schemas or a docblock describing request/response.
- Update the relevant `docs/tech/.../README.md` when changing a feature.
- Run `npm run docs:generate` before merging.

## Optional: Generate ERD locally

The ERD is disabled in CI to avoid Puppeteer on Vercel. If you still want ERD locally:

1. Install the generator:
   ```bash
   npm i -D prisma-erd-generator
   ```
2. Temporarily add this generator block to `prisma/schema.prisma` (do not commit it):
   ```
   generator erd {
     provider = "prisma-erd-generator"
     output   = "../docs/data/model.svg"
   }
   ```
3. Generate:
   ```bash
   npx prisma generate
   ```
4. Open `/docs` in the app; it will render `docs/data/model.svg` if present.

## Local development setup and troubleshooting

- App stack: Next.js 16 (App Router / Turbopack) with PostgreSQL for auth, RSVP, attendance, and other database-backed features.
- Required env vars for basic local development: `DATABASE_URL`, `NEXTAUTH_SECRET`, and `NEXTAUTH_URL`.
- Keep credentials and tokens out of docs and source control; store local values in your `.env` only.
- If dependency installation fails because of peer dependency conflicts, retry with your package manager's legacy/relaxed peer dependency mode.
- If Prisma client generation fails during install scripts, run dependency installation without scripts first, then run Prisma client generation manually.
- Known local troubleshooting themes:
  - Prisma CLI and `@prisma/client` major versions must match.
  - React and `react-dom` major versions must match to avoid component test runtime failures.
  - ESLint major upgrades can conflict with `eslint-config-next` and bundled plugins; align versions before debugging lint rule output.
