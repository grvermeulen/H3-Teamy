# Docs Contribution Guide

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
