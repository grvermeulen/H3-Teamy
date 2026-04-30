# Agentic Project Template

A starter template that bundles the agent configs and CI workflows used in
[`grvermeulen/H3-Teamy`](https://github.com/grvermeulen/H3-Teamy), without any
of the project-specific code. Use it to bootstrap a new repo with the same
"how I like to work" setup.

## What's in here

### Agent / editor config

- **`AGENTS.md`** — learned user preferences + a stub `Learned Workspace Facts`
  section to fill in per project.
- **`.claude/commands/`** — Claude Code slash commands (e.g. `loop-on-ci`).
- **`.cursor/`** — Cursor rules, skills, hooks, and settings.
  - `rules/` — agent-agnostic coding rules (security, API design, frontend &
    backend patterns, database migrations, verification loop, search-first,
    code review, de-slop).
  - `skills/` — `code-review`, `deslop`, `search-first`, `verification-loop`.
  - `hooks.ts` — example before-command and after-edit hooks.
- **`.cursorignore`** — files Cursor should not include in prompts.
- **`.coderabbit.yaml`** — CodeRabbit review profile, docstring threshold,
  custom finishing-touch checks (`deslop`, `nl-check`).
- **`.github/copilot-instructions.md`** — GitHub Copilot agent instructions.
- **`.github/pull_request_template.md`** — default PR template.

### Workflows (`.github/workflows/`)

All Node-dependent workflows are guarded with `hashFiles('package.json') != ''`
so they no-op until you wire up a real project.

- `agentic-ci.yml` — lint, typecheck, build, test on push/PR.
- `ai-review.yml` — AI review of high-risk paths (API, lib, db).
- `coderabbit-major-gate.yml` — blocks Dependabot merges with unresolved
  CodeRabbit major/critical comments.
- `copilot-code-review.yml` — auto-requests Copilot review on every PR.
- `copilot-setup-steps.yml` — environment setup for Copilot agent.
- `dependabot-auto-merge.yml` — closes superseded Dependabot PRs and
  auto-merges green ones.
- `post-merge-verify.yml` — production smoke tests after merge to main.
- `dependabot.yml` — npm daily updates with security/version groups.

## How to use as a template

1. On GitHub, **Settings → General → Template repository** for this repo:
   toggle **on**.
2. Click **Use this template → Create a new repository** from the GitHub UI.
3. In the new repo:
   - Fill in `AGENTS.md` "Learned Workspace Facts".
   - Update the intro paragraph in `.github/copilot-instructions.md`.
   - Add your stack (`package.json`, `tsconfig.json`, framework configs, etc.)
   - Add `prisma/`, `src/`, `tests/`, etc. as needed.
   - Adjust `.coderabbit.yaml` `language` if not Dutch and remove the
     `nl-check` custom rule if you don't want a Dutch-strings gate.
   - Add `.husky/` hooks if you want pre-commit lint/typecheck/test.
   - Configure repository secrets used by the workflows
     (e.g. `OPENAI_API_KEY`, `PRODUCTION_VERIFY_BASE_URL`,
     `SENTRY_AUTH_TOKEN`) — see each workflow file for what it expects.

## Removed compared to `H3-Teamy`

Service- and stack-specific workflows that aren't reusable as-is have been
omitted: Neon branch cleanup, Vercel preview e2e, Sentry issue sync, Vercel
deployment failure monitor, docs generation. Add them back per project if
relevant.
