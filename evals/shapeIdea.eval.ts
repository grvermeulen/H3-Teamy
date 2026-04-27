import { Eval } from "braintrust";
import {
  IdeaShapeSchema,
  shapeIdea,
  type IdeaShape,
  type ShapeIdeaInput,
} from "../src/lib/ai/productManager";

type ExpectedShape = {
  aiTheme?: string;
  aiImpact?: IdeaShape["aiImpact"];
};

type EvalCase = {
  input: ShapeIdeaInput;
  expected: ExpectedShape;
};

// TODO: replace these synthetic placeholders with a real golden set sourced
// from `feedback` rows where `type = "IDEA"`. See AGENTS.md learned facts on
// where ideas live in the database. Keep ~20-50 examples once seeded.
const placeholderCases: EvalCase[] = [
  {
    input: {
      title: "Bigger Yes button on RSVP card",
      body: "Tap target is too small on phones — I keep missing it.",
    },
    expected: { aiTheme: "RSVP UX", aiImpact: "Medium" },
  },
  {
    input: {
      title: "Push notification before training",
      body: "I want a reminder 1 hour before training so I don't forget.",
    },
    expected: { aiTheme: "Notifications", aiImpact: "High" },
  },
  {
    input: {
      title: "Export season stats as CSV",
      body: "Coach wants to crunch numbers in a spreadsheet at season end.",
    },
    expected: { aiTheme: "Reports", aiImpact: "Low" },
  },
];

Eval("H3-Teamy shapeIdea", {
  data: () => placeholderCases,
  task: async (input) => shapeIdea(input),
  scores: [
    ({ output }) => ({
      name: "schema_valid",
      score: IdeaShapeSchema.safeParse(output).success ? 1 : 0,
    }),
    ({ output, expected }) => ({
      name: "theme_match",
      score: expected?.aiTheme && output.aiTheme === expected.aiTheme ? 1 : 0,
    }),
    ({ output, expected }) => ({
      name: "impact_match",
      score:
        expected?.aiImpact && output.aiImpact === expected.aiImpact ? 1 : 0,
    }),
  ],
});
