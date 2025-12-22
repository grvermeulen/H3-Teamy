import { readFileSync } from "fs";
import { join } from "path";

function getDatabaseUrl(): string {
  // Check if we're running a migration command
  // prisma.config.ts is only used for migrations in Prisma 7
  const isMigration = process.argv.some(
    (arg) =>
      arg.includes("migrate") ||
      arg.includes("db push") ||
      arg.includes("db pull"),
  );

  // For non-migration commands (like prisma generate), allow Accelerate URLs
  // Prisma will use DATABASE_URL from environment or schema.prisma
  if (!isMigration) {
    // Return DATABASE_URL if available, otherwise empty string
    // Prisma generate doesn't need a database connection
    return process.env.DATABASE_URL || process.env.PRISMA_DATABASE_URL || "";
  }

  // For migrations, ALWAYS prefer DIRECT_DATABASE_URL (direct PostgreSQL connection)
  // Accelerate URLs don't work with migrations
  if (process.env.DIRECT_DATABASE_URL) {
    const directUrl = process.env.DIRECT_DATABASE_URL.trim();
    if (directUrl.startsWith("prisma://")) {
      throw new Error(
        "DIRECT_DATABASE_URL cannot be a Prisma Accelerate URL.\n" +
          "Please set DIRECT_DATABASE_URL to a direct PostgreSQL connection string.\n" +
          "You can find your direct connection string in the Prisma Console: https://console.prisma.io",
      );
    }
    return directUrl;
  }

  // Try DATABASE_URL environment variable (but check if it's Accelerate)
  if (process.env.DATABASE_URL) {
    const url = process.env.DATABASE_URL.trim();
    // Check if it's an Accelerate URL (only during migrations)
    if (url.startsWith("prisma://")) {
      throw new Error(
        "DATABASE_URL is a Prisma Accelerate URL, which is not supported for migrations.\n" +
          "Please set DIRECT_DATABASE_URL environment variable with a direct PostgreSQL connection string.\n" +
          "You can find your direct connection string in the Prisma Console: https://console.prisma.io\n" +
          'Example: DIRECT_DATABASE_URL="postgresql://user:password@host:5432/database"',
      );
    }
    return url;
  }

  // Fallback to prisma_url.txt file (only during migrations)
  // But warn if it's an Accelerate URL
  try {
    const urlPath = join(process.cwd(), "prisma_url.txt");
    const url = readFileSync(urlPath, "utf-8").trim();
    // Check if it's an Accelerate URL
    if (url.startsWith("prisma://")) {
      throw new Error(
        "The URL in prisma_url.txt is a Prisma Accelerate URL, which is not supported for migrations.\n" +
          "Please set DIRECT_DATABASE_URL environment variable with a direct PostgreSQL connection string.\n" +
          "You can find your direct connection string in the Prisma Console: https://console.prisma.io\n" +
          'Example: DIRECT_DATABASE_URL="postgresql://user:password@host:5432/database"',
      );
    }
    return url;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Accelerate")) {
      throw error;
    }
    // If file doesn't exist and we're in a migration, throw error
    if (isMigration) {
      throw new Error(
        "No database URL found for migrations.\n" +
          "Please set DIRECT_DATABASE_URL environment variable with a direct PostgreSQL connection string.\n" +
          'Example: DIRECT_DATABASE_URL="postgresql://user:password@host:5432/database"',
      );
    }
    return "";
  }
}

export default {
  datasource: {
    url: getDatabaseUrl(),
  },
};
