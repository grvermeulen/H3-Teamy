---
name: deslop
description: Remove AI-generated code slop after implementation — narration comments, defensive type checks, tests that test the language, over-engineering.
disable-model-invocation: true
---

# De-Slop Pass

After AI-assisted implementation, run a focused cleanup to remove common AI-generated code artifacts. This is a separate pass from implementation — do not constrain generation, clean up afterward.

## Your Task

1. Run `git diff --stat` to see changed files.
2. For each changed file, scan for the patterns below and remove them.
3. Preserve all behavior; only remove slop.
4. Run tests after cleanup to ensure nothing broke: `npx vitest run`

## What to Remove

### Unnecessary Comments

Remove comments that narrate what the code does. Keep only comments that explain non-obvious intent or caveats.

```typescript
// BAD: Narrating
// Get the user from the database
const user = await prisma.user.findUnique({ where: { id } });
// Check if user exists
if (!user) { ... }

// GOOD: Code speaks for itself
const user = await prisma.user.findUnique({ where: { id } });
if (!user) { ... }
```

### Defensive Checks on Trusted Paths

Remove runtime checks for things TypeScript already guarantees.

```typescript
// BAD: TypeScript already guarantees this
if (typeof userId === "string" && userId.length > 0) {
  const user = await getUser(userId);
  if (user !== null && user !== undefined) { ... }
}

// GOOD: Trust the type system
const user = await getUser(userId);
if (!user) return null;
```

### Tests That Test the Language/Framework

Remove tests that verify TypeScript, arrays, or framework behavior. Keep tests that verify business logic.

```typescript
// BAD
it("should accept a string parameter", () => {
  expect(typeof formatName("test")).toBe("string");
});
it("should return an array", () => {
  expect(Array.isArray(getUsers())).toBe(true);
});

// GOOD
it("should format name as 'Voornaam A.' for display", () => {
  expect(formatName("Jan", "Jansen")).toBe("Jan J.");
});
```

### Over-Engineered Abstractions

- Factory patterns for a single implementation
- Abstract classes with only one concrete subclass
- Wrapper functions that just forward all arguments
- Configuration objects for something used exactly once

### Other Slop

- `console.log` statements (use Sentry logger)
- Commented-out code blocks
- Unused imports
- English strings in user-facing code (must be Dutch)
- Overly verbose error handling that obscures the actual logic
- `any` type casts added "to make it work"

## Key Principle

> Rather than adding negative instructions which constrain generation quality, add a separate de-slop pass. Two focused steps outperform one constrained step.
