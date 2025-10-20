import { prisma } from "../src/lib/db";

async function time<T>(
  fn: () => Promise<T>,
): Promise<{ ms: number; value: T }> {
  const start = Date.now();
  const value = await fn();
  return { ms: Date.now() - start, value };
}

async function main() {
  process.env.PRISMA_CACHE_ENABLED = process.env.PRISMA_CACHE_ENABLED || "1";

  // Warm cache run: roster-like read
  const first = await time(() =>
    prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true },
    }),
  );
  const second = await time(() =>
    prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true },
    }),
  );

  console.log(
    JSON.stringify(
      {
        firstMs: first.ms,
        secondMs: second.ms,
        count: Array.isArray(second.value) ? second.value.length : null,
      },
      null,
      2,
    ),
  );

  // Compare payloads
  if (JSON.stringify(first.value) !== JSON.stringify(second.value)) {
    console.warn("Warning: payloads differ between cached and fresh reads.");
  }

  // Toggle cache off and compare timing
  process.env.PRISMA_CACHE_ENABLED = "0";
  const cold = await time(() =>
    prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true },
    }),
  );
  console.log(JSON.stringify({ cacheOffMs: cold.ms }, null, 2));
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
