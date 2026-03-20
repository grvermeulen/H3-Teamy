---
name: verification-loop
description: Run the 6-phase pre-PR quality gate (build, typecheck, lint, test, security scan, diff review). Use before creating or updating pull requests.
disable-model-invocation: true
---

# Verification Loop

Run this checklist after completing a feature or significant change, before creating a PR.

## Your Task

Execute each phase in order. Stop and fix any failure before continuing. Produce a verification report at the end.

## Phases

### Phase 1: Build

```bash
npm run build
```

If build fails, stop and fix before continuing.

### Phase 2: Type Check

```bash
npx tsc --noEmit
```

Fix all type errors. Zero tolerance.

### Phase 3: Lint

```bash
npm run lint
```

Fix errors; warnings are acceptable if pre-existing.

### Phase 4: Tests

```bash
npx vitest run
```

All tests must pass. If a test fails:

1. Check if the failure is from your change or pre-existing
2. Fix your change if it caused the failure
3. Never delete or skip a test to make the suite pass

### Phase 5: Security Scan

Quick checks on changed files:

- No hardcoded secrets (`sk-`, `ghp_`, `AKIA`, password literals)
- No `console.log` of sensitive data
- Auth checks present on protected API routes
- Prisma queries use parameterized inputs (default with Prisma ORM)

### Phase 6: Diff Review

```bash
git diff --stat
```

Review each changed file for:

- Unintended changes (formatting-only diffs, accidental file modifications)
- Missing error handling in new code paths
- Missing Sentry instrumentation in new catch blocks
- Dutch strings for all user-facing messages

## Phase 7: Doc update

```bash
npm run docs:generate
```

## Report Format

After running all phases, produce:

```
VERIFICATION REPORT
==================
Build:     [PASS/FAIL]
Types:     [PASS/FAIL] (X errors)
Lint:      [PASS/FAIL] (X warnings)
Tests:     [PASS/FAIL] (X/Y passed)
Security:  [PASS/FAIL] (X issues)
Diff:      X files changed

Overall:   [READY/NOT READY] for PR
```

## When to Run

- After completing a feature branch
- Before opening or updating a PR
- After resolving merge conflicts
- After a major refactor
