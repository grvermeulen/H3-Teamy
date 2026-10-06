# JEV PR-risico (TypeSafe)

Geautomatiseerde, **niet-blokkerende** PR-risico-inschatting met [JEV](https://docs.typesafe.ai/) (`jev-1.13.0`). Elke run post een sticky PR-comment in het Nederlands en schrijft een voorspelling naar de dataset-branch `jev-risk-data`. Na merge (≥ 7 dagen) labelt een scheduled workflow de uitkomst zodat we kalibratie kunnen meten.

## Setup

### Secrets

| Secret | Waar | Verplicht |
|--------|------|-----------|
| `JEV_API_KEY` | **Settings → Secrets and variables → Actions** | Ja (anders skip + comment "JEV niet beschikbaar") |
| `JEV_API_KEY` | **Settings → Secrets and variables → Dependabot** | Ja voor Dependabot-PRs (die zien geen Actions-secrets) |

Geen secret in logs of commits. Fork-PRs worden overgeslagen.

### Labels (handmatig)

| Label | Betekenis |
|-------|-----------|
| `post-merge-issue` | Bevestigd probleem na merge |
| `jev:incident` | Zelfde, expliciet voor JEV-evaluatie |
| `jev:false-alarm` | Geen probleem — override negatieve signalen |
| `jev:no-issue` | Geen probleem — override |

## Workflows

| Workflow | Trigger | Doel |
|----------|---------|------|
| `.github/workflows/jev-pr-risk.yml` | `pull_request` → `image` | JEV-call, PR-comment, prediction append |
| `.github/workflows/jev-outcome-labeling.yml` | Dagelijks 07:00 UTC + `workflow_dispatch` | Outcome labeling + rapport |

De JEV-job **faalt nooit** de PR (script exit 0). Dependabot auto-merge (`statusCheckRollup: SUCCESS`) blijft werken.

## Dataset (`jev-risk-data`)

Orphan branch, **niet** gemerged naar `image`:

- `predictions.jsonl` — één record per head-SHA (laatste assessment wint)
- `outcomes.jsonl` — gelabelde uitkomst per gemergde PR (≥ 7 dagen oud)

Waarom orphan branch:

- Geen wijzigingen op `image` → geen Vercel production/preview deploy door dataset-commits
- `vercel.json` zet `git.deploymentEnabled.jev-risk-data: false` als extra vangnet
- JSONL + git push met retry bij concurrente PR-runs

Bij merge markeert `mark_merged` de laatste voorspelling vóór merge als `final_before_merge: true`.

## Uitkomst-signalen

Automatisch (evidence in `outcomes.jsonl`):

- Revert-PR/commit die de oorspronkelijke PR noemt
- Follow-up PR binnen 7 dagen met overlappende files + fix/hotfix/revert in titel
- Gefaalde check-runs op de merge-commit
- Gefaalde Vercel production status op merge-commit
- Labels `post-merge-issue` / `jev:incident`

Handmatige override: `jev:false-alarm` / `jev:no-issue`.

## Rapport

```bash
npm run jev:report
```

Of via de dagelijkse workflow (job summary). Toont o.a. confusion matrix (high/medium vs low), precision/recall voor `high` (alleen bij voldoende N), kalibratie per risiconiveau, flag hit rates, Dependabot vs mens.

Bij **N < 5** gekoppelde paren: rapport vermeldt dat metrics te klein zijn.

## Kosten

JEV pricing (indicatief): ~**$0.042 per M input tokens**; output tokens gratis. Typische PR-state is enkele duizenden input tokens.

## Code

| Pad | Rol |
|-----|-----|
| `src/lib/jev/` | State building, JEV client, comment, dataset, outcomes, report (unit-tested) |
| `scripts/jev/assess-pr.ts` | CI entry: assess + comment + dataset |
| `scripts/jev/mark-merged.ts` | Final prediction marker |
| `scripts/jev/label-outcomes.ts` | Outcome labeling |
| `scripts/jev/report.ts` | Rapport CLI |

Zie [TypeSafe API docs](https://docs.typesafe.ai/api) voor vraagtypes (`choice`, `noul`, `score`).
