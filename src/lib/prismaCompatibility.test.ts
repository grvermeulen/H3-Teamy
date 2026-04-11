import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type PackageJsonDependencies = {
  dependencies?: Record<string, string>;
};

function getMajor(version: string): string {
  const match = version.match(/\d+/);
  if (!match) {
    throw new Error(`Kan major-versie niet bepalen uit: ${version}`);
  }
  return match[0];
}

describe("Prisma compatibility", () => {
  it("keeps Prisma packages on the same major version", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as PackageJsonDependencies;
    const dependencies = packageJson.dependencies ?? {};
    const prismaVersions = [
      dependencies["@prisma/adapter-pg"],
      dependencies["@prisma/client"],
      dependencies.prisma,
    ];

    expect(prismaVersions).toHaveLength(3);
    expect(new Set(prismaVersions.map(getMajor))).toEqual(new Set(["7"]));
  });

  it("defines the datasource URL in prisma.config.ts for Prisma 7", () => {
    const prismaConfigSource = readFileSync(
      resolve(process.cwd(), "prisma.config.ts"),
      "utf8",
    );

    expect(prismaConfigSource).toContain('from "prisma/config"');
    expect(prismaConfigSource).toContain("process.env.DATABASE_URL");
  });

  it("keeps the datasource URL out of schema.prisma (Prisma 7)", () => {
    const schemaSource = readFileSync(
      resolve(process.cwd(), "prisma/schema.prisma"),
      "utf8",
    );

    expect(schemaSource).not.toMatch(/url\s*=\s*env\("DATABASE_URL"\)/);
  });
});
