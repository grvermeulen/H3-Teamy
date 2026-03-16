---
name: search-first
description: Research before coding — search for existing solutions in the repo and npm before writing new utilities, helpers, or integrations.
disable-model-invocation: true
---

# Search First

Before writing a new utility, helper, abstraction, or integration, search for existing solutions.

## Your Task

When the user asks to add functionality or create something new, run through this decision flow before writing code. Use Grep and Glob to search the codebase. Check npm for packages. Only write custom code if nothing suitable exists.

## Decision Flow

1. **Does it already exist in this repo?**
   - Search `src/lib/`, `src/components/` with Grep/Glob
   - Reuse and import — never duplicate

2. **Is this a common problem with a well-maintained npm package?**
   - Check npm for packages with good maintenance signals
   - Prefer packages with: >1K weekly downloads, recent commits, TypeScript types

3. **Is there a pattern in the project that handles this?**
   - Check existing services, hooks, utilities for similar patterns
   - Follow the established pattern rather than inventing a new one

4. **Nothing found?**
   - Write custom code, but informed by research
   - Place it in the appropriate shared location (`src/lib/` or `src/components/`)

## Decision Matrix

| Signal                                  | Action                                        |
| --------------------------------------- | --------------------------------------------- |
| Exact match in repo                     | **Reuse** — import the existing module        |
| Well-maintained npm package, MIT/Apache | **Adopt** — install and use directly          |
| Partial match, good foundation          | **Extend** — install + write thin wrapper     |
| Nothing suitable                        | **Build** — write custom, place in `src/lib/` |

## Project-Specific Search Locations

| Need                   | Check First                                                   |
| ---------------------- | ------------------------------------------------------------- |
| Date/time formatting   | `src/lib/eventId.ts`, existing date utilities                 |
| User display info      | `src/lib/userUtils.ts` (`displayName`, etc.)                  |
| Database queries       | `src/lib/services/` for existing service methods              |
| Validation schemas     | `src/lib/schemas/` for existing Zod schemas                   |
| Auth utilities         | `src/lib/authOptions.ts`, `src/lib/activeUser.ts`             |
| Badge/attendance logic | `src/lib/badges.ts`, `src/lib/training.ts`                    |
| Cache operations       | `src/lib/kv.ts` for Redis patterns                            |
| Report generation      | `src/lib/mvpNarrative.ts`, `src/lib/reportExtractProvider.ts` |

## Anti-Patterns

- Writing a new helper without checking if one exists in `src/lib/`
- Installing a massive package for one small feature
- Wrapping a library so heavily it loses its benefits
- Copy-pasting code between files instead of extracting to a shared module
