import { JEV_MODEL } from "./types";

/** Typed JEV questions for PR risk assessment (English instructions for model quality). */
export const JEV_PR_QUESTIONS = {
  risk_level: {
    type: "choice",
    instructions:
      "How risky is merging this pull request for production stability and correctness?",
    criteria: {
      low:
        "Small, well-scoped change; unlikely to break runtime behavior; tests or docs only; trivial config.",
      medium:
        "Moderate scope; touches app logic but with plausible tests; some uncertainty about edge cases.",
      high:
        "Large or sensitive change; auth/security/data paths; missing tests for risky logic; migrations or infra.",
    },
  },
  severity: {
    type: "score",
    instructions:
      "If something goes wrong after merge, how severe would the impact likely be?",
    criteria: ["None", "Minor", "Moderate", "Severe"],
  },
  security_concern: {
    type: "noul",
    instructions:
      "Does this PR introduce or worsen a security concern (auth bypass, secrets, injection, unsafe deps)?",
    criteria: {
      true: "Plausible security regression or new attack surface.",
      false: "No meaningful security concern in the changed code.",
    },
  },
  data_migration_risk: {
    type: "noul",
    instructions:
      "Is there meaningful risk of schema/migration issues or data loss from this PR?",
    criteria: {
      true: "Prisma/schema/migration changes or data writes without safe rollout.",
      false: "No schema migration risk or data-loss path.",
    },
  },
  likely_runtime_regression: {
    type: "noul",
    instructions:
      "Is a production runtime regression (crash, broken API, bad deploy) likely from this change?",
    criteria: {
      true: "High chance users hit errors or broken flows after merge.",
      false: "Runtime behavior likely unchanged or safely guarded.",
    },
  },
  test_coverage_adequate: {
    type: "noul",
    instructions:
      "Do the changed or existing tests plausibly cover the behavioral risk of this PR?",
    criteria: {
      true: "Tests reasonably cover the changed logic and main failure modes.",
      false: "Risky logic changed with little or no targeted test coverage.",
    },
  },
} as const;

/** Full JEV request body shape (state filled at runtime). */
export function buildJevRequest(state: unknown): {
  state: unknown;
  model: string;
  questions: typeof JEV_PR_QUESTIONS;
} {
  return {
    state,
    model: JEV_MODEL,
    questions: JEV_PR_QUESTIONS,
  };
}
