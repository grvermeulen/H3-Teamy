# Events

## Summary

Event listing and basic endpoints under `src/app/api/events`.

## Entry Points

- UI: `src/app/page.tsx` and component `src/components/EventList.tsx`
- API: `src/app/api/events/route.ts`
- Geschiedenis-import (admin): `docs/tech/events/history-import.md`, `src/app/api/admin/team-events/import/route.ts`

## Data Model

- Prisma: relates to `Rsvp` and event identifiers handled in helpers.
