# Speelboek

## Summary

Library of waterpolo drills (tactics and techniques) with a top-down half-pool
diagram per step, the role of every position per step, a per-drill "jouw
positie" highlight (remembered in `localStorage`) and a simple step animation.
Drills come from two sources: static TypeScript (`src/lib/speelboek/drills/`)
and trainer-made drills stored in Postgres (`SpeelboekDrill`). Trainers build
drills in an editor, optionally seeded by an AI draft from a typed/dictated
description and/or a whiteboard photo, attach drills to a training as a
programme (shared in WhatsApp through a `wa.me` link), and players can tick a drill off
("Ik snap 'm") or ask the trainer a question. Concept and mockups live in
`docs/specs/speelboek/`.

## Entry Points

- Pages: `src/app/speelboek/page.tsx` (library + upcoming programme), `[id]/page.tsx` (drill), `nieuw/page.tsx` (trainer: AI draft or empty editor; `?van=<id>` copies a drill), `[id]/bewerken/page.tsx` (trainer: edit a stored drill; static ids redirect to `nieuw?van=`)
- Trainer programme block: `src/app/trainer/attendance/[date]/page.tsx` renders `TrainingProgramEditor`
- Components (`src/components/speelboek/`): `PoolDiagram`, `DrillDetail`, `DrillEngagementPanel`, `SpeelboekLibrary`, `NewDrillFlow`, `EditDrillGate`, `DrillEditor`, `PoolEditorCanvas`, `TrainingProgramEditor`, `useDictation` (Web Speech API, `nl-NL`)
- API (`src/app/api/speelboek/**`, all `force-dynamic`):
  - `GET/POST drills`, `GET/PUT/DELETE drills/[id]` (write = trainer; static ids → 409)
  - `GET drills/[id]/engagement`, `PUT drills/[id]/ack`, `POST drills/[id]/questions`, `PATCH drills/[id]/questions/[questionId]` (resolve, trainer), `GET acks` (my ticked drills)
  - `GET/PUT program/[date]`, `GET program/upcoming`
  - `POST ai/draft` (trainer, rate limit `speelboek-ai-draft` 6/min, `maxDuration` 60s)
- Services: `speelboekService.ts` (merge static + stored: `getAllDrills`, `findDrill`, `getCounterpart`, `isStaticDrill`), `speelboekStore.ts` (Prisma CRUD, slug ids), `trainingProgramService.ts`, `drillEngagementService.ts`
- Client-safe helpers: `src/lib/speelboek/library.ts` (`filterDrills`, `groupByCategory`, `isRecentlyAdded`, `rosterLabels`, `LibraryDrill`), `editor.ts` (pure editor state transitions), `programShare.ts` (WhatsApp text for a programme; `TrainingProgramEditor` shares it through `WhatsAppShareLink` once saved), `lineup.ts` (standard 6-v-6), `apiGuards.ts` (route guards)
- AI: `src/lib/ai/speelboekDraft.ts` (`AiDrillDraftSchema`, `SPEELBOEK_DRAFT_SYSTEM_PROMPT`, `toDrillInput`, `draftDrill`) via `generateObject` + `getStructuredGatewayModel()`
- Schema/types: `src/lib/schemas/speelboek.ts`; Prisma models in `prisma/schema.prisma`

Client components import from `src/lib/speelboek/library.ts`, never from
`speelboekService.ts` (which pulls in Prisma).

## Data Model

Zod (`src/lib/schemas/speelboek.ts`):

- `Drill` — slug `id`, `title`, `summary`, `category` (`AANVAL` | `VERDEDIGING` | `TECHNIEK` | `KEEPER`), `level`, `roster`, `steps`, `keyPoints`, `commonMistakes`, optional `counterpartId` and `sourceFeedbackId`, `addedOn` ("Nieuw" badge for 30 days).
- `DrillInput` — what the editor/API send: `Drill` without `id`/`addedOn`, plus `published`.
- `DrillStep` — `title`, `text`, `frame`, `roles[]`; `DiagramFrame` — `attackColor`, `players[]` (`id`, `team` `OFF`/`DEF`/`GK`, `x`, `y` in a 300×150 viewBox, goal at the top), `arrows[]` (`MOVE` | `PASS` | `SHOT`), `ballPlayerId`.
- `drillDraftRequestSchema` — `description` (≤ 4000) and/or `imageDataUrl` (png/jpeg/webp ≤ ~5.5 MB); `programInputSchema` — up to 20 `{ drillId, minutes?, note? }`; `drillQuestionInputSchema` — 3–500 chars.

Prisma (migration `20261103180000_speelboek_trainer_drills`):

- `SpeelboekDrill` — `id` (slug), `title`, `category`, `published`, `content` (Json: the full `Drill`), `createdById`.
- `TrainingProgramItem` — `date` (YYYY-MM-DD), `drillId`, `position`, `minutes`, `note`; unique per `(date, drillId)`.
- `DrillAck` — unique `(drillId, userId)`; `DrillQuestion` — `text`, `resolvedAt`.

`LibraryDrill = Drill & { source: "static" | "trainer"; published }`. Drafts
(`published: false`) are hidden from the library and programme picker for
players but reachable via their link; trainers see them with a "Concept" badge.

## Conventions

- Attack white, defence blue (swappable per frame), keeper red, ball yellow.
- Standard numbering seen from the attack: 1 = right wing → 5 = left wing, 6 = centre forward; `standardLineup()` is the editor's starting frame.
- Player ids: `p1`–`p6` attackers, `d1`–`d6` defenders, `gk` keeper; the editor's `nextPlayerId` continues numbering.
- AI schema uses `nullable()` instead of `optional()` because OpenAI's strict JSON-schema mode requires every property to be required.
- Cache/DB failures in `getAllDrills` fall back to the static library and report to Sentry.
- Migrations are applied manually: preview with `npm run db:migrate:preview` before merge, production with `npm run db:migrate:production` after merge.

## Adding a static drill

1. Create `src/lib/speelboek/drills/<name>.ts` exporting a `z.input<typeof drillSchema>`; start from `standardLineup()`.
2. Register it in `drills/index.ts`; `drills/index.test.ts` validates ids, roles, keeper count and counterparts.
3. Bump `package.json` and add a `CHANGELOG` entry if players should get a What's-new round.

## Not yet built (see `docs/specs/speelboek/README.md`)

- Answering a question in-app (trainers resolve questions; answers go via the pool/WhatsApp).
- Whiteboard photo → precise coordinates is best-effort; the trainer corrects the draft in the editor.
- Per-player "jouw positie" coupling to the roster of the team.
