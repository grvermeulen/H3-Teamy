# Geschiedenis-import teamwedstrijden

## Probleem

Sportlink levert in de iCal-feed vaak **geen** recent gespeelde wedstrijden meer. Sinds #906 merged `fetchTeamEvents` Postgres-events (`Event`) in de kalender. Ontbrekende wedstrijden moeten **eenmalig** (idempotent) in `Event` staan — niet in cache-only fabricatie.

## Admin-API

- **GET** `/api/admin/team-events/import?preset=h3-gap-oct-nov-2026` — droge run (admin-sessie verplicht).
- **POST** `/api/admin/team-events/import` — body:

```json
{
  "dryRun": true,
  "preset": "h3-gap-oct-nov-2026"
}
```

Zet `dryRun: false` om te schrijven. Alleen `isAdminUser`.

## Preset `h3-gap-oct-nov-2026`

| Canonical id                    | Titel                 | Start (ISO)                | KNZB                                                                                     |
| ------------------------------- | --------------------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| `20261010--ndd-h3-de-rijn-h3`   | NDD H3 - De Rijn H3   | `2026-10-10T16:40:00.000Z` | [De Rijn uitslagen](https://waterpolo.knzb.nl/waterpolo/verenigingen/vereniging/DHS128P) |
| `20261107--de-rijn-h3-flevo-h3` | De Rijn H3 - Flevo H3 | `2026-11-07T17:50:00.000Z` | [Wedstrijd 451382](https://waterpolo.knzb.nl/waterpolo/wedstrijd/451382)                 |

Geen uitslagen in de database; RSVP/verslagen blijven gekoppeld aan hetzelfde `eventId`.

## UI

`/admin` → kaart **Ontbrekende wedstrijdgeschiedenis** (droge run + import).

## Productie-uitvoering (menselijke goedkeuring)

1. Ingelogd als admin op productie.
2. Droge run → preview toont `create` / `update` / `unchanged`.
3. Importeer → `written` ≥ 1 verwacht bij eerste run.
4. Verifieer: `GET /api/events` bevat beide ids; dashboard toont ze onder **Dit seizoen**.

Geen productie-database-writes via agent zonder expliciete gebruikersbevestiging.
