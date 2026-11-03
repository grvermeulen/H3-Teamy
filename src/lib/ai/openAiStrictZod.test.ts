import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  findOpenAiStrictRequiredGaps,
  openAiStrictSchemaGaps,
} from "./openAiStrictZod";
import { SpeelboekGenerateResultSchema } from "./speelboekGenerate";

describe("openAiStrictZod", () => {
  it("flags optional properties missing from required (roster.number)", () => {
    const positionNumber = z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]);
    const bad = z.object({
      roster: z.array(
        z.object({
          name: z.string(),
          number: positionNumber.optional(),
        }),
      ),
    });
    const gaps = openAiStrictSchemaGaps(bad);
    expect(gaps.some((g) => g.endsWith("roster.items.number"))).toBe(true);
  });

  it("accepts SpeelboekGenerateResultSchema for strict output", () => {
    expect(openAiStrictSchemaGaps(SpeelboekGenerateResultSchema)).toEqual([]);
  });

  it("findOpenAiStrictRequiredGaps walks nested objects", () => {
    const gaps = findOpenAiStrictRequiredGaps({
      type: "object",
      properties: {
        roster: {
          type: "array",
          items: {
            type: "object",
            properties: { number: { type: "number" }, name: { type: "string" } },
            required: ["name"],
          },
        },
      },
      required: ["roster"],
    });
    expect(gaps).toContain("roster.items.number");
  });
});
