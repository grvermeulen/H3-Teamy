# Auth

## Summary

Email/password auth via `next-auth` (session cookie). Auxiliary identity linking under `src/app/api/identity`.

## Entry Points

- UI: `src/app/login/page.tsx`
- API: `src/app/api/auth/**`

## Dependencies

- Prisma `User`, `Identity`
- Sentry tracing in API routes

## Observability

- Spans: `http.server` on auth endpoints

## Security

- Avoid user enumeration; generic responses on failure
