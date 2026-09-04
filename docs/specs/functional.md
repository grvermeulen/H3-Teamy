## Functional Specification (Current App)

This document reflects the features that exist in the code today. Planned or future ideas live in the backlog section.

### Overview

- Mobile-first web app to manage team events and attendance.

### Current Capabilities

<!-- AUTOGEN:features -->

| Feature        | Docs                               |
| -------------- | ---------------------------------- |
| admin          | docs/tech/admin/README.md          |
| arena          | docs/tech/arena/README.md          |
| auth           | docs/tech/auth/README.md           |
| branding       | docs/tech/branding/README.md       |
| events         | docs/tech/events/README.md         |
| identity-link  | docs/tech/identity-link/README.md  |
| password-reset | docs/tech/password-reset/README.md |
| profile        | docs/tech/profile/README.md        |
| reports        | docs/tech/reports/README.md        |
| rsvp           | docs/tech/rsvp/README.md           |
| training       | docs/tech/training/README.md       |

<!-- /AUTOGEN:features -->

### Implemented User Journeys

- Sign in / register
- Request password reset and set a new password via token
- View events and RSVP list pages
- View training overview and attendance
- Generate example event report
- Update profile

### Roles & Permissions

- Basic role checks as implemented in routes; no advanced RBAC UI yet.

### Notifications

- Email used for password reset when `ENABLE_EMAIL=true` and `RESEND_API_KEY` configured.

### API and Routes Inventory

<!-- AUTOGEN:routes -->

# Routes Inventory

## API Routes

- /api/admin/feedback
- /api/admin/feedback/[id]
- /api/admin/status
- /api/admin/users
- /api/auth/[...nextauth]
- /api/auth/link
- /api/auth/passkey/login-options
- /api/auth/passkey/login-verify
- /api/auth/passkey/register-options
- /api/auth/passkey/register-verify
- /api/auth/passkeys
- /api/auth/password/reset-confirm
- /api/auth/password/reset-request
- /api/auth/register
- /api/cron/idea-weekly
- /api/debug/attendance
- /api/debug/cleanup/orphans
- /api/debug/migrate/event-ids
- /api/debug/persistence
- /api/events
- /api/feedback
- /api/identity/adopt
- /api/identity/status
- /api/link/complete
- /api/link/start
- /api/me
- /api/profile
- /api/report
- /api/report/extract
- /api/report/generate
- /api/report/mvp
- /api/report/mvp/close
- /api/report/mvp/reopen
- /api/rsvp
- /api/rsvp/list
- /api/test-image
- /api/trainer/status
- /api/training/attendance
- /api/training/nudge
- /api/training/overview
- /api/training/sessions
- /api/users
- /api/whats-new
- /api/whats-new/ack

## Pages

-
- /admin
- /admin/feedback
- /attendance
- /docs
- /login
- /privacy
- /profile
- /report/[eventId]
- /reset-request
- /reset/[token]
- /terms
- /trainer/attendance
- /trainer/attendance/[date]

<!-- /AUTOGEN:routes -->

### Backlog / Out-of-scope for now

- Push notifications and richer announcement system
- Lineups, carpool, advanced assignments
