## Functional Specification (Current App)

This document reflects the features that exist in the code today. Planned or future ideas live in the backlog section.

### Overview

- Mobile-first web app to manage team events and attendance.

### Current Capabilities

<!-- AUTOGEN:features -->

| Feature        | Docs                               |
| -------------- | ---------------------------------- |
| admin          | docs/tech/admin/README.md          |
| auth           | docs/tech/auth/README.md           |
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

## Pages

<!-- /AUTOGEN:routes -->

### Backlog / Out-of-scope for now

- Push notifications and richer announcement system
- Lineups, carpool, advanced assignments
