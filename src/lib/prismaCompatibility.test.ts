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
    expect(new Set(prismaVersions.map(getMajor))).toEqual(new Set(["5"]));
  });

  it("avoids Prisma 7-only config helpers while Prisma 5 is installed", () => {
    const prismaConfigSource = readFileSync(
      resolve(process.cwd(), "prisma.config.ts"),
      "utf8",
    );

    expect(prismaConfigSource).not.toContain('from "prisma/config"');
  });
});
