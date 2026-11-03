import { readFileSync } from "node:fs";
import path from "node:path";
import { Eval } from "braintrust";
import {
  draftDrill,
  type DrillDraftResult,
} from "../src/lib/ai/speelboekDraft";
import {
  drillDraftRequestSchema,
  drillInputSchema,
  type DrillInput,
} from "../src/lib/schemas/speelboek";

/**
 * Braintrust evals for the speelboek drill draft (`draftDrill`).
 *
 * Dictation cases are realistic Dutch transcripts a trainer would speak.
 * They score the draft model, not the browser Web Speech API. Photo cases
 * use tiny whiteboard fixtures (pool sketch plus readable Dutch writing) and
 * score that those written words show up in the title, step text, or role text.
 * A fact can match when the words are split across a sentence; the exact
 * board sentence is not required.
 *
 * Run from the repository root:
 *
 * - Upload a run (needs `BRAINTRUST_API_KEY` and a gateway credential):
 *   `npm run eval`
 * - Score locally without uploading (gateway credential only):
 *   `npx braintrust eval evals/speelboekDraft.eval.ts --no-send-logs`
 *
 * Gateway credential: `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` (loaded from
 * `.env` / `.env.local` by the Braintrust CLI). Without one, this file
 * registers nothing: the model is not called and no score is recorded.
 *
 * Fixtures (generated, not photos of a real board):
 * - `evals/fixtures/whiteboard-meeuw.png` — half-pool, players 2 and 6, dashed
 *   pass arrow. Writing: "Titel: Oefening Meeuw" and
 *   "Positie 2 roept meeuw en past naar 6."
 * - `evals/fixtures/whiteboard-driehoek.png` — half-pool, player 4, a triangle,
 *   shot arrow. Writing: "Titel: Driehoekje" and
 *   "Positie 4 zwemt de driehoek en schiet laag."
 */

type DraftRequest = {
  description: string;
  imageDataUrl?: string;
};

/** One spoken fact. `patterns` are regex sources; any hit counts. Empty `patterns` means only `positions` apply. */
type SpokenConcept = {
  label: string;
  patterns: string[];
  positions?: number[];
};

type DictationExpected = {
  concepts: SpokenConcept[];
};

type PhotoExpected = {
  /**
   * Facts painted on the fixture. Each fact is a list of alternatives; every
   * alternative-group must hit the title, step, or role copy. Word order may differ.
   */
  facts: string[][][];
};

const DUTCH_MARKERS = [
  "de",
  "het",
  "een",
  "naar",
  "van",
  "niet",
  "met",
  "bij",
  "zwem",
  "past",
  "pass",
  "schiet",
  "schot",
  "bal",
  "keeper",
  "verded",
  "aanval",
  "meter",
  "positie",
  "tikt",
  "speelt",
  "man",
] as const;

const dictationCases: Array<{
  input: DraftRequest;
  expected: DictationExpected;
}> = [
  {
    input: {
      description:
        "Ehm oké jongens, tip-in. Vleugel één zwemt langs z'n man naar de tweede paal. Vijf heeft de bal en past hem hoog, en één tikt hem in één keer binnen. Zes blijft gewoon liggen.",
    },
    expected: {
      concepts: [
        { label: "tip-in", patterns: ["tip"] },
        { label: "zwemactie", patterns: ["zwem", "\\bmove\\b"] },
        { label: "pass", patterns: ["past", "\\bpass\\b"] },
        {
          label: "afronding door 1",
          patterns: ["tikt", "schiet", "schot"],
          positions: [1],
        },
        { label: "positie 5", patterns: [], positions: [5] },
        { label: "positie 6", patterns: [], positions: [6] },
      ],
    },
  },
  {
    input: {
      description:
        "Oké, vier-twee man-meer. De verdediger van zes doen we eruit, dus zes tegen vijf. Bal begint bij drie. Drie speelt naar twee, twee speelt direct door naar één, en één schiet op doel.",
    },
    expected: {
      concepts: [
        {
          label: "man-meer",
          patterns: ["man-?\\s?meer", "man-meer-structure"],
        },
        { label: "pass", patterns: ["speelt", "past", "\\bpass\\b"] },
        { label: "schot", patterns: ["schiet", "schot"] },
        { label: "posities 3, 2 en 1", patterns: [], positions: [3, 2, 1] },
      ],
    },
  },
  {
    input: {
      description:
        "Even de zone, vijf tegen zes. Verdediging niet man-op-man, die staat op de vijf meter en de zes meter. Aanval speelt alleen rond: drie past naar vier, vier past naar vijf. Nog niet schieten, alleen de bal rond.",
    },
    expected: {
      concepts: [
        { label: "zone", patterns: ["zone"] },
        {
          label: "vijf en zes meter",
          patterns: [
            "vijf meter",
            "5 meter",
            "zes meter",
            "6 meter",
            "5m",
            "6m",
          ],
        },
        {
          label: "rondspelen 3-4-5",
          patterns: ["past", "\\bpass\\b"],
          positions: [3, 4, 5],
        },
      ],
    },
  },
];

function whiteboardDataUrl(fileName: string): string {
  const filePath = path.join(process.cwd(), "evals", "fixtures", fileName);
  const encoded = readFileSync(filePath).toString("base64");
  return `data:image/png;base64,${encoded}`;
}

function normalizeCopy(value: string): string {
  return value.toLowerCase().replace(/['’]/g, "").replace(/\s+/g, " ").trim();
}

function mentionsPosition(haystack: string, position: number): boolean {
  const digit = new RegExp(`(^|[^0-9])${position}([^0-9]|$)`);
  return digit.test(haystack) || haystack.includes(`p${position}`);
}

function actionHaystack(draft: DrillInput): string {
  const parts: string[] = [
    draft.title,
    draft.summary,
    ...draft.keyPoints,
    ...draft.commonMistakes,
  ];
  for (const entry of draft.roster) {
    parts.push(entry.name, entry.label, entry.playerId);
  }
  for (const step of draft.steps) {
    parts.push(step.title, step.text);
    for (const role of step.roles) {
      parts.push(role.text, role.playerId);
    }
    const defenders = step.frame.players.filter(
      (player) => player.team === "DEF",
    );
    if (defenders.length > 0 && defenders.length < 6) {
      parts.push("man-meer-structure");
    }
    for (const player of step.frame.players) {
      parts.push(player.id);
    }
    for (const arrow of step.frame.arrows) {
      parts.push(arrow.kind, arrow.playerId);
      if (arrow.kind === "PASS") parts.push("pass");
      if (arrow.kind === "MOVE") parts.push("zwem");
      if (arrow.kind === "SHOT") parts.push("schot");
    }
  }
  return normalizeCopy(parts.join("\n"));
}

function writtenCopy(draft: DrillInput): string {
  const parts: string[] = [draft.title];
  for (const step of draft.steps) {
    parts.push(step.title, step.text);
    for (const role of step.roles) parts.push(role.text);
  }
  return normalizeCopy(parts.join("\n"));
}

function trainerCopy(draft: DrillInput): string {
  return normalizeCopy(
    [
      draft.title,
      draft.summary,
      ...draft.keyPoints,
      ...draft.commonMistakes,
      ...draft.roster.map((entry) => entry.name),
      ...draft.steps.flatMap((step) => [
        step.title,
        step.text,
        ...step.roles.map((role) => role.text),
      ]),
    ].join("\n"),
  );
}

function conceptMatches(haystack: string, concept: SpokenConcept): boolean {
  const textOk =
    concept.patterns.length === 0 ||
    concept.patterns.some((pattern) => new RegExp(pattern, "i").test(haystack));
  const positionsOk = (concept.positions ?? []).every((position) =>
    mentionsPosition(haystack, position),
  );
  return textOk && positionsOk;
}

function spokenActionScore(
  draft: DrillInput,
  concepts: SpokenConcept[],
): number {
  if (concepts.length === 0) return 0;
  const haystack = actionHaystack(draft);
  const hits = concepts.filter((concept) =>
    conceptMatches(haystack, concept),
  ).length;
  return hits / concepts.length;
}

function dutchScore(draft: DrillInput): number {
  const haystack = trainerCopy(draft);
  const hits = DUTCH_MARKERS.filter((marker) =>
    haystack.includes(marker),
  ).length;
  if (hits >= 4) return 1;
  return hits / 4;
}

function writtenFactScore(draft: DrillInput, facts: string[][][]): number {
  if (facts.length === 0) return 0;
  const haystack = writtenCopy(draft);
  const hits = facts.filter((fact) =>
    fact.every((alternatives) =>
      alternatives.some((alternative) =>
        haystack.includes(normalizeCopy(alternative)),
      ),
    ),
  ).length;
  return hits / facts.length;
}

function schemaScore(draft: DrillInput): number {
  return drillInputSchema.safeParse(draft).success ? 1 : 0;
}

async function draftFromRequest(
  input: DraftRequest,
): Promise<DrillDraftResult> {
  const parsed = drillDraftRequestSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(`speelboek eval input rejected: ${detail}`);
  }
  return draftDrill({
    description: parsed.data.description,
    imageDataUrl: parsed.data.imageDataUrl,
  });
}

function gatewayCredentialPresent(): boolean {
  return Boolean(
    process.env.AI_GATEWAY_API_KEY?.trim() ||
    process.env.VERCEL_OIDC_TOKEN?.trim(),
  );
}

if (!gatewayCredentialPresent()) {
  console.info(
    "H3-Teamy speelboek draft evals skipped: no AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN, so the model is not called and no score is recorded.",
  );
} else {
  Eval<DraftRequest, DrillDraftResult, DictationExpected>(
    "H3-Teamy speelboek draft dictation",
    {
      data: () => dictationCases,
      task: draftFromRequest,
      maxConcurrency: 1,
      timeout: 600_000,
      scores: [
        ({ output }) => ({
          name: "schema_valid",
          score: schemaScore(output.draft),
        }),
        ({ output }) => ({
          name: "dutch",
          score: dutchScore(output.draft),
        }),
        ({ output, expected }) => ({
          name: "spoken_actions",
          score: expected
            ? spokenActionScore(output.draft, expected.concepts)
            : 0,
        }),
      ],
    },
  );

  Eval<DraftRequest, DrillDraftResult, PhotoExpected>(
    "H3-Teamy speelboek draft whiteboard",
    {
      data: () => [
        {
          input: {
            description: "",
            imageDataUrl: whiteboardDataUrl("whiteboard-meeuw.png"),
          },
          expected: {
            facts: [
              [["meeuw"]],
              [["roep"]],
              [
                ["past", "pass"],
                ["naar 6", "positie 6", "naar zes"],
              ],
            ],
          },
        },
        {
          input: {
            description: "",
            imageDataUrl: whiteboardDataUrl("whiteboard-driehoek.png"),
          },
          expected: {
            facts: [
              [["driehoek"]],
              [["zwem"], ["driehoek"]],
              [["schiet", "schot"], ["laag"]],
            ],
          },
        },
      ],
      task: draftFromRequest,
      maxConcurrency: 1,
      timeout: 600_000,
      scores: [
        ({ output }) => ({
          name: "schema_valid",
          score: schemaScore(output.draft),
        }),
        ({ output, expected }) => ({
          name: "written_text",
          score: expected ? writtenFactScore(output.draft, expected.facts) : 0,
        }),
      ],
    },
  );
}
