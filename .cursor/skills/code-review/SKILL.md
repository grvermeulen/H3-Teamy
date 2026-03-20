---
name: code-review
description: Run a structured code review with severity tiers (CRITICAL to LOW). Use for self-review before a PR or when reviewing someone else's PR.
disable-model-invocation: true
---

# Code Review

Use this checklist when reviewing code — either your own before a PR, or someone else's PR.

## Your Task

1. Run `git diff --staged` and `git diff` to see all changes. If no diff, check recent commits with `git log --oneline -5`.
2. Read the changed files and surrounding context.
3. Apply the review checklist below, from CRITICAL to LOW.
4. Report findings in the output format. Only report issues you are >80% confident are real problems.
5. End with a summary table and verdict.

## Confidence-Based Filtering

- **Report** issues you are >80% confident are real problems
- **Skip** stylistic preferences unless they violate project conventions
- **Skip** issues in unchanged code unless they are CRITICAL security issues
- **Consolidate** similar issues ("5 functions missing error handling" not 5 separate findings)

## Review by Severity

### CRITICAL — Must Fix Before Merge

- Hardcoded secrets (API keys, passwords, tokens)
- SQL injection or unsafe raw queries
- Missing auth checks on protected routes
- XSS via `dangerouslySetInnerHTML` with user content
- Exposed sensitive data in error responses or logs

### HIGH — Should Fix

- Functions >50 lines — split into smaller focused functions
- Files >800 lines — extract modules by responsibility
- Deep nesting >4 levels — use early returns and extract helpers
- Missing error handling — empty catch blocks, unhandled promise rejections
- `console.log` statements left in production code
- Missing tests for new code paths
- Dead code — commented-out code, unused imports, unreachable branches
- Missing Sentry instrumentation in catch blocks

### React/Next.js Specific (HIGH)

- Missing dependency arrays in `useEffect`/`useMemo`/`useCallback`
- `useState`/`useEffect` in Server Components
- Array index used as `key` when items can reorder
- Props drilled through 3+ levels without context or composition
- Missing loading/error states for data fetching
- English UI strings (must be Dutch)

### Backend Specific (HIGH)

- Unvalidated request input (no Zod schema)
- Unbounded queries (missing `take`/`limit`)
- N+1 query patterns (loop with individual DB calls)
- Missing rate limiting on public endpoints
- Error messages leaking internal details

### MEDIUM — Nice to Fix

- Inefficient algorithms where a better approach exists
- Missing memoization for expensive computations
- Large bundle imports (import entire library vs tree-shakeable)
- Missing caching for repeated expensive operations

### LOW — Note for Future

- TODOs without issue references
- Missing JSDoc on exported functions
- Single-letter variable names in non-trivial contexts
- Magic numbers without named constants

## Output Format

For each finding:

```text
[CRITICAL] Description
File: src/path/to/file.ts:42
Issue: What's wrong and why it matters
Fix: How to fix it
```

End with:

```text
| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0     | pass   |
| HIGH     | 2     | warn   |
| MEDIUM   | 1     | info   |
| LOW      | 0     | -      |

Verdict: [APPROVE / WARNING / BLOCK]
```

- **Approve**: No CRITICAL or HIGH issues
- **Warning**: HIGH issues only (can merge with caution)
- **Block**: CRITICAL issues — must fix before merge
