# Preview en productie databases

Doel: lokaal ontwikkelen tegen de **preview** database met dummy data, en
schema-wijzigingen consistent uitrollen naar **preview én productie**.

## Omgevingen

| Omgeving    | Wanneer                 | Doel                                                            |
| ----------- | ----------------------- | --------------------------------------------------------------- |
| Production  | merge naar `main`       | Echte gebruikers en data                                        |
| Preview     | elke PR / branch deploy | Test deploy met dummy data                                      |
| Development | `npm run dev` lokaal    | Werkt tegen de **preview** DB (zelfde data als preview deploys) |

`npm run dev` (zonder suffix) gebruikt de oude flow op basis van `.env`/`.env.local`.
Gebruik **`npm run dev:preview`** voor de gewenste preview-DB workflow.

## Eerste setup van de preview omgeving

Voer eenmalig uit nadat een aparte preview-database is geprovisioned:

```bash
# 1. Pull preview env naar .env.preview.local
npm run env:pull:preview

# 2. Migreer schema naar preview DB
npm run db:migrate:preview

# 3. Seed dummy data
npm run db:seed:preview
```

`scripts/check-preview-env.ts` detecteert wanneer `.env.preview.local` per
ongeluk nog naar de productie-tenant wijst en breekt `dev:preview` af.

## Dagelijkse workflow

```bash
npm run dev:preview
```

Doet automatisch: `vercel env pull` (preview) → env-check → `next dev` met
de preview env vars geladen.

## Schema-wijzigingen

1. Pas `prisma/schema.prisma` aan.
2. Maak een migratie:

   ```bash
   dotenv -e .env.preview.local -- prisma migrate dev --name <beschrijving>
   ```

   Dit slaat de migratie op onder `prisma/migrations/...` en past `m` toe
   op de **preview** database.

3. Open een PR. CI bouwt een preview deploy die dezelfde migrations
   uitvoert via `prisma migrate deploy` (Vercel build step).
4. Controleer de preview deploy.
5. Na merge naar `main` past de productie build automatisch dezelfde
   migrations toe.

### Handmatig synchroniseren (zelden nodig)

Als preview en productie ooit uit elkaar lopen:

```bash
npm run db:migrate:both   # eerst preview, dan productie
```

`db:migrate:both` weigert door te gaan als preview faalt — productie
blijft ongemoeid totdat preview groen is.

### Idempotente migrations

Recente migrations gebruiken `IF NOT EXISTS` / `DO $$ ... EXCEPTION`-blokken
omdat preview-databases soms restanten van vorige branches bevatten. Houd
deze stijl aan voor nieuwe migrations zolang preview en productie dezelfde
DB gedeeld hebben kunnen.

## Wat te doen als preview "stuk" lijkt

1. `npm run env:pull:preview` — sleutels kunnen geroteerd zijn.
2. `tsx scripts/check-preview-env.ts` — meldt missende vars of een verkeerde DB.
3. `npm run db:migrate:preview` — schema bijgewerkt?
4. `npm run db:seed:preview` — dummy data aanwezig?

## Veiligheidsregels

- `prisma/seed.ts` weigert te draaien tegen production-achtige URLs (env-check)
  tenzij `ALLOW_SEED_PROD=1` expliciet gezet is.
- `db:migrate:production` runt **alleen** met `.env.production.local`. Pull
  deze handmatig en pleeg geen routinematige migrations vanaf je laptop —
  Vercel doet dat tijdens de productie build.
