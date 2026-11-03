import { jsonSchema } from "ai";
import type { z } from "zod";

type ZodJsonNode = {
  def?: {
    type?: string;
    shape?: Record<string, ZodJsonNode>;
    element?: ZodJsonNode;
    innerType?: ZodJsonNode;
  };
  type?: string;
};

/**
 * Walks the Zod JSON Schema export from the AI SDK and returns paths to `.optional()`
 * fields. OpenAI structured output rejects those (every property must be required
 * or expressed as `.nullable()` instead).
 */
export function findZodOptionalPaths(
  node: ZodJsonNode,
  path: string[] = [],
): string[] {
  const defType = node.def?.type ?? node.type;
  if (defType === "optional") {
    return [path.join(".") || "(root)"];
  }
  const gaps: string[] = [];
  if (node.def?.shape) {
    for (const [key, child] of Object.entries(node.def.shape)) {
      gaps.push(...findZodOptionalPaths(child, [...path, key]));
    }
  }
  if (node.def?.element) {
    gaps.push(...findZodOptionalPaths(node.def.element, [...path, "items"]));
  }
  if (node.def?.innerType && defType !== "optional") {
    gaps.push(...findZodOptionalPaths(node.def.innerType, path));
  }
  return gaps;
}

/**
 * Returns Zod optional paths that would make OpenAI strict `generateObject` fail
 * (see Sentry JAVASCRIPT-NEXTJS-4Z / reportExtractProvider.ts).
 */
export function openAiStrictSchemaGaps(schema: z.ZodType): string[] {
  const exported = jsonSchema(
    schema as unknown as Parameters<typeof jsonSchema>[0],
  ) as { jsonSchema?: ZodJsonNode };
  const root = exported.jsonSchema ?? (exported as ZodJsonNode);
  return findZodOptionalPaths(root).filter(Boolean);
}

/** @deprecated Use {@link findZodOptionalPaths} — kept for unit tests of path walking. */
export function findOpenAiStrictRequiredGaps(
  node: {
    type?: string;
    properties?: Record<string, unknown>;
    items?: unknown;
    required?: string[];
  },
  path: string[] = [],
): string[] {
  const gaps: string[] = [];
  if (node.type === "object" && node.properties) {
    const required = new Set(node.required ?? []);
    for (const key of Object.keys(node.properties)) {
      const childPath = [...path, key];
      if (!required.has(key)) {
        gaps.push(childPath.join("."));
      }
      const child = node.properties[key] as typeof node;
      gaps.push(...findOpenAiStrictRequiredGaps(child, childPath));
    }
  }
  if (node.type === "array" && node.items) {
    gaps.push(
      ...findOpenAiStrictRequiredGaps(node.items as typeof node, [
        ...path,
        "items",
      ]),
    );
  }
  return gaps;
}
