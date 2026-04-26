---
description: Watch the current PR's CI checks, fix failures, address CodeRabbit comments, and resolve resolved review threads — looping until everything is green.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, TaskCreate, TaskUpdate, TaskList
argument-hint: "[pr-number]   # optional, defaults to the PR for the current branch"
---

# `/loop-on-ci`

You're going to drive a PR to a green, fully-resolved state. The user has shipped a branch and opened a PR; CodeRabbit and the CI workflows are doing their thing. Your job is to keep iterating — pull failures, fix them, push, and resolve review threads — until there is nothing left to fix.

**Repo**: H3-Teamy (Next.js 16, Prisma, Vitest). Read `AGENTS.md` and `.cursor/rules/always.md` first — they encode the project's coding standards (Dutch UI strings, no inline `style` props, `try/catch` + `Sentry.captureException` everywhere, JSDoc ≥80% per `.coderabbit.yaml`, `vi.stubEnv` in tests, etc.). Apply them by default.

## How the loop runs

1. **Pick the PR.**
   - If `$ARGUMENTS` is a number, use that as the PR.
   - Otherwise: `gh pr view --json number,headRefName,url --jq '{number, head: .headRefName, url}'`. Fail loud if the current branch has no PR.

2. **Snapshot CI state.**

   ```
   gh pr checks <pr> --watch=false
   gh pr view <pr> --json statusCheckRollup --jq '.statusCheckRollup[] | {name: .name, status: .status, conclusion: .conclusion}'
   ```

   Categorize each check: `success`, `failure`, `pending`, `neutral`/`warning` (e.g. CodeRabbit docstring coverage warning).

3. **Pull review feedback.**
   - Inline comments: `gh api repos/:owner/:repo/pulls/<pr>/comments --paginate --jq '.[] | {id, node_id, path, line, body: (.body | .[0:600]), user: .user.login}'`
   - Top-level review summaries: `gh api repos/:owner/:repo/pulls/<pr>/reviews --paginate --jq '.[] | {id, user: .user.login, state, body: (.body // "" | .[0:600])}'`
   - Filter to unresolved CodeRabbit / cursor-bot threads. (Resolved threads are noise.)

4. **Plan the round.** Use `TaskCreate` for each distinct failure / comment cluster. Group by file or by rule (e.g. "Dutch translation across 3 files", "Sentry try/catch in 5 routes"). Don't attempt one-off fixes ad-hoc — make the work visible.

5. **Apply fixes.**
   - Read the file the comment cites; verify the issue is still present (CodeRabbit sometimes flags lines you've already changed).
   - Fix it the project's idiomatic way — match the patterns in surrounding code, not generic best practices.
   - For systemic comments (e.g. "no inline `style`"), apply across the whole PR, not just the cited line.

6. **Verify locally before pushing.**

   ```
   npm run lint
   npx tsc --noEmit
   npm test -- --run
   ```

   All three must pass. If any fail, fix and retry — do **not** push red code.

7. **Push the fixup.**

   ```
   git add <files>
   git commit -m "<conventional-commit message focused on the why>"
   git push
   ```

   Use a focused message like `fix: address CodeRabbit review on PR #<n>` or `fix: dutch translations + sentry instrumentation`.

8. **Resolve the threads you fixed.** This is non-negotiable per `.cursor/rules/always.md` line 51 and `AGENTS.md`.

   For every comment you addressed, get its `node_id` (the `PRRC_…` value from step 3) and find its parent review-thread id, then call `resolveReviewThread`:

   ```bash
   # Step 1: list threads with their ids and the comments they hold
   gh api graphql -f query='
     query($owner: String!, $repo: String!, $pr: Int!) {
       repository(owner: $owner, name: $repo) {
         pullRequest(number: $pr) {
           reviewThreads(first: 100) {
             nodes {
               id
               isResolved
               comments(first: 5) { nodes { id databaseId path line body } }
             }
           }
         }
       }
     }' -F owner=<owner> -F repo=<repo> -F pr=<pr>

   # Step 2: for each thread you fixed, resolve it
   gh api graphql -f query='
     mutation($threadId: ID!) {
       resolveReviewThread(input: {threadId: $threadId}) { thread { id isResolved } }
     }' -F threadId=<thread-node-id>
   ```

   Tip: pipe the threads JSON into a tiny script and resolve everything where every comment has been addressed (test passes / file changed since the comment was made).

9. **Re-snapshot CI.** Wait briefly for the new push to register, then re-run step 2. If new failures appeared (e.g. a flaky test, a CodeRabbit follow-up comment), loop back to step 4.

10. **Stop conditions.**
    - All required checks `success` and the warning-level checks are either `success` or explicitly accepted.
    - All CodeRabbit / bot review threads are `isResolved: true` or have been replied to with a justification when not resolving.
    - `gh pr view <pr> --json mergeable,mergeStateStatus` reports a clean state.

    Print a one-paragraph end-of-loop summary: rounds run, fixes shipped, threads resolved, residual warnings.

## Conventions

- Use `gh` for everything GitHub-related (per `AGENTS.md`).
- Don't merge the PR yourself unless the user explicitly asks. Stop at "ready to merge".
- Don't bypass hooks (no `--no-verify`, no `--no-gpg-sign`).
- If a CodeRabbit comment conflicts with the codebase's established patterns, reply with a brief justification on the thread (`gh pr review <pr> --comment` or `gh api .../comments/{id}/replies`) instead of forcing the change.
- Make memory-of-the-rule moves: when you discover a recurring fix (e.g. "every new API route needs `try/catch` + `Sentry`"), save it as a feedback memory before continuing.

## When to bail out

- You've looped 3 times and the same check is still failing → stop and ask the user; you may be misreading the failure.
- A failing test is environmental (DB unreachable, secret missing) → stop and ask the user to fix the env, don't paper over it.
- A CodeRabbit comment requires a product decision (e.g. "is this rate limit too low?") → ask before guessing.

The loop ends when the PR is genuinely ready, not when you run out of obvious things to do.
