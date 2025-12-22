# Agent Guardrails & Hooks

Adopt Cursor Hooks to increase safety and quality:

- Block destructive shell commands (e.g., `rm -rf /`, `git push --force`, mass deletions outside repo).
- Auto-run `eslint --fix` after edits where possible.
- Prefer running formatters/linters in dry-run before applying large edits.
- Never write to `.env*` or secret files; redact tokens in logs.

If hooks runtime is available, the repository defines `.cursor/hooks.ts` with guardrails.
