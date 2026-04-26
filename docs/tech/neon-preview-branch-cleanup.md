# Neon preview branches opruimen (Vercel-integratie)

Vercel kan per preview-deploy een **Neon-databasebranch** aanmaken (bijv. integratie `h3-teamy-preview-db`). Op gratis/laag betaalde plannen geldt een **maximum aantal branches**. Als dat vol is, faalt provisioning met:

> Branch limit reached. Upgrade your plan or delete unused branches.

Dit document is het **beleid** voor opruimen; de uitvoering is handmatig of via het script hieronder.

## Beleid (team)

1. **Primary branch nooit verwijderen** — dat is de vaste lijn (productie / hoofd-timeline in Neon).
2. **Preview-branches zijn wegwerp** — zodra een PR is gemerged of duidelijk verlaten, mag de bijbehorende Neon-branch weg (data was test-only).
3. Het **cleanup-script** draait dagelijks automatisch en handelt dit af (zie onder).
4. **Upgrade** alleen overwegen als het team structureel meer dan ~10 gelijktijdige preview-branches nodig heeft; anders is opschonen goedkoper.

## Automatisch script (aanbevolen flow)

Het script werkt in twee fases:

1. **Orphan pruning** — verwijdert Neon-branches waarvan de bijbehorende git-branch geen open PR meer heeft op GitHub. Vereist `GITHUB_TOKEN` + `GITHUB_REPOSITORY`.
2. **Count-based pruning** — verwijdert de oudste leaf-branches als het totaal boven `--max-total` uitkomt (standaard 12).

Eenmalig in Neon: **Settings → API keys** een key aanmaken. **Project ID** staat op de project-settingspagina.

```bash
export NEON_API_KEY="..."
export NEON_PROJECT_ID="autumn-disk-XXXXXX"   # jouw project-id

# 1) Alleen tonen wat weg zou gaan (standaard veilig)
npm run neon:cleanup-branches

# 2) Echt verwijderen (orphans + count-based)
npm run neon:cleanup-branches -- --execute

# Optioneel: andere limiet
npm run neon:cleanup-branches -- --max-total=10 --execute

# Lokaal met orphan pruning (optioneel):
export GITHUB_TOKEN="ghp_..."
export GITHUB_REPOSITORY="grvermeulen/H3-Teamy"
npm run neon:cleanup-branches -- --execute
```

Het script verwijdert **alleen niet-primary** branches en begint bij **bladeren** (geen kind-branches meer), zodat de Neon-regel "eerst kinderen, dan ouder" gevolgd wordt.

## Geplande run in GitHub

Workflow: `.github/workflows/neon-branch-cleanup.yml` (dagelijks 06:00 UTC + **Actions → Neon branch cleanup → Run workflow**).

Repository secrets (Settings → Secrets and variables → Actions):

- `NEON_API_KEY`
- `NEON_PROJECT_ID`

`GITHUB_TOKEN` wordt automatisch door Actions meegegeven en hoeft niet als secret aangemaakt te worden.

Zonder `NEON_API_KEY` / `NEON_PROJECT_ID` slaat de job zichzelf over (groene run, geen deletes).

## Gerelateerd

- [Preview en productie databases](./preview-and-production-databases.md)
