import { readFileSync } from "node:fs";
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
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
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
      new URL("../../prisma.config.ts", import.meta.url),
      "utf8",
    );

    expect(prismaConfigSource).not.toContain('from "prisma/config"');
  });
});
