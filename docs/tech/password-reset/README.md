# Password Reset

## Summary

Generates a short-lived token (Redis or in-memory) and emails a link to set a new password.

## Entry Points

- UI request: `src/app/reset-request/page.tsx`
- UI confirm: `src/app/reset/[token]/page.tsx`
- API: `src/app/api/auth/password/reset-request/route.ts`, `src/app/api/auth/password/reset-confirm/route.ts`

## Environment

- `ENABLE_EMAIL=true` (optional — auto-enables when `RESEND_API_KEY`, `EMAIL_FROM`, and `APP_URL` are set)
- `RESEND_API_KEY`
- `APP_URL`
- `EMAIL_FROM` (verified sender in Resend)

## Observability

- Sentry spans on both routes; capture exception on send failure.

## Security

- Generic success response to prevent user enumeration
- Token TTL 60m; single-use via Redis key
