# Neon preview branches opruimen (Vercel-integratie)

Vercel kan per preview-deploy een **Neon-databasebranch** aanmaken (bijv. integratie `h3-teamy-preview-db`). Op gratis/laag betaalde plannen geldt een **maximum aantal branches**. Als dat vol is, faalt provisioning met:

> Branch limit reached. Upgrade your plan or delete unused branches.

Dit document is het **beleid** voor opruimen; de uitvoering is handmatig of via het script hieronder.

## Beleid (team)

1. **Primary branch nooit verwijderen** — dat is de vaste lijn (productie / hoofd-timeline in Neon).
2. **Preview-branches zijn wegwerp** — zodra een PR is gemerged of duidelijk verlaten, mag de bijbehorende Neon-branch weg (data was test-only).
3. **Maandelijks (of bij “branch limit”-fout)** iemand met Neon-toegang:
   - Neon Console → project → **Branches**;
   - sorteer op **laatst gebruikt / oud**;
   - verwijder **oude preview-/feature-branches** waarvan de PR al dicht is.
4. **Vóór massaal verwijderen**: even checken of geen open PR die branch nog nodig heeft voor een actieve preview.
5. **Upgrade** alleen overwegen als het team structureel meer dan ~10 gelijktijdige preview-branches nodig heeft; anders is opschonen goedkoper.

## Automatisch script (aanbevolen flow)

Eenmalig in Neon: **Settings → API keys** een key aanmaken. **Project ID** staat op de project-settingspagina.

```bash
export NEON_API_KEY="..."
export NEON_PROJECT_ID="autumn-disk-XXXXXX"   # jouw project-id

# 1) Alleen tonen wat weg zou gaan (standaard veilig)
npm run neon:cleanup-branches

# 2) Echt verwijderen tot max. 12 branches (incl. primary)
npm run neon:cleanup-branches -- --execute

# Optioneel: andere limiet
npm run neon:cleanup-branches -- --max-total=10 --execute
```

Het script verwijdert **alleen niet-primary** branches en begint bij **bladeren** (geen kind-branches meer), zodat de Neon-regel “eerst kinderen, dan ouder” gevolgd wordt.

## Optioneel: geplande run in GitHub

Workflow: `.github/workflows/neon-branch-cleanup.yml` (dagelijks 06:00 UTC + **Actions → Neon branch cleanup → Run workflow**).

Repository secrets (Settings → Secrets and variables → Actions):

- `NEON_API_KEY`
- `NEON_PROJECT_ID`

Zonder deze variabelen slaat de job zichzelf over (groene run, geen deletes).

## Gerelateerd

- [Preview en productie databases](./preview-and-production-databases.md)
