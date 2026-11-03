# Speelboek

## Summary

Library of waterpolo drills (tactics and techniques) with a top-down half-pool
diagram per step, the role of every position per step, a per-drill "jouw
positie" highlight (remembered in `localStorage`) and a simple step animation.
Content is static TypeScript validated with Zod; no database tables yet.
Concept, mockups and the roadmap (trainer editor, voice/AI authoring) live in
`docs/specs/speelboek/`.

## Entry Points

- UI: `src/app/speelboek/page.tsx` (library), `src/app/speelboek/[id]/page.tsx` (drill)
- Components: `src/components/speelboek/` (`PoolDiagram`, `DrillDetail`, `SpeelboekLibrary`)
- Service: `src/lib/services/speelboekService.ts` (`listDrills`, `getDrill`, `getCounterpart`, `isRecentlyAdded`, `groupByCategory`, `rosterLabels`)
- Content: `src/lib/speelboek/drills/*.ts`, exported and schema-validated in `drills/index.ts`
- Lineup helpers: `src/lib/speelboek/lineup.ts` (`standardLineup`, `STANDARD_POSITIONS`, `STANDARD_ROSTER`, labels)
- Schema/types: `src/lib/schemas/speelboek.ts`
- Navigation: `BottomNav` and `SessionStatus` link to `/speelboek`

## Data Model

Everything derives from the Zod schemas in `src/lib/schemas/speelboek.ts`:

- `Drill` — slug `id`, `title`, `summary`, `category` (`AANVAL` | `VERDEDIGING` | `TECHNIEK` | `KEEPER`), `level`, `roster`, `steps`, `keyPoints`, `commonMistakes`, optional `counterpartId` (same situation from the other side) and `sourceFeedbackId` (ideeënbus), `addedOn` (drives the "Nieuw" badge for 30 days).
- `DrillRosterEntry` — the players a drill is about: `playerId`, cap `label`, position `name`.
- `DrillStep` — `title`, `text`, `frame`, `roles[]` (`playerId` → one-line task).
- `DiagramFrame` — `attackColor` (`WHITE` | `BLUE`), `players[]` (`id`, `team` `OFF`/`DEF`/`GK`, `x`, `y` in a 300×150 viewBox, goal at the top), `arrows[]` (`MOVE` | `PASS` | `SHOT` from a player to a point, optional `via` control point), `ballPlayerId`.

The diagram is data, not an image: `PoolDiagram` renders any frame, and the same
structure is what a future editor or AI generator would produce.

## Conventions

- Attack white, defence blue (swappable per frame via `attackColor`), keeper red
  with the number in the defending team's colour, ball yellow.
- Standard numbering seen from the attack: 1 = right wing → 5 = left wing,
  6 = centre forward; `standardLineup()` returns this 6-v-6 as a starting frame.
- Player ids: `p1`–`p6` attackers, `d1`–`d6` defenders, `gk` keeper.

## Adding a drill

1. Create `src/lib/speelboek/drills/<name>.ts` exporting a `z.input<typeof drillSchema>`; start from `standardLineup()` and override positions per step.
2. Register it in `drills/index.ts`. Parsing happens at module load, so schema errors fail tests and the build.
3. `drills/index.test.ts` checks: unique slugs, every roster/role/arrow/ball id exists in each frame, every roster player has a role in every step, exactly one keeper per frame, counterparts resolve.
4. Bump `package.json` and add a `CHANGELOG` entry if players should get a What's-new round.

## Not yet built (see `docs/specs/speelboek/README.md`)

- Trainer programme per training and WhatsApp share (route B).
- Drill editor with the standard lineup, drag/arrows per step (mockup 6).
- Voice/text → AI-generated steps and animation (mockup 7).
- Player tick-offs ("Ik snap 'm") and questions to the trainer.
