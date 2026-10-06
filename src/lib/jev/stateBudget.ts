import { JEV_PR_QUESTIONS } from "./questions";

/** JEV limit: state + longest question must stay under 32k tokens. */
export const JEV_STATE_QUESTION_TOKEN_LIMIT = 32_000;

/** Safety margin for truncation_note and tokenizer drift. */
export const STATE_TOKEN_SAFETY_MARGIN = 1_500;

/**
 * Conservative token estimate (JEV tokenizes denser than chars/4).
 * @param text - Raw text or serialized JSON.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.2);
}

/** Estimates API tokens for a JSON-serializable value. */
export function estimateJsonTokens(value: unknown): number {
  return estimateTokens(JSON.stringify(value));
}

/** Token estimate for the longest single question block. */
export function longestQuestionTokenEstimate(): number {
  let max = 0;
  for (const question of Object.values(JEV_PR_QUESTIONS)) {
    max = Math.max(max, estimateJsonTokens(question));
  }
  return max;
}

/** Max tokens for the state object (state + longest question must be < 32k). */
export const MAX_STATE_TOKENS =
  JEV_STATE_QUESTION_TOKEN_LIMIT -
  longestQuestionTokenEstimate() -
  STATE_TOKEN_SAFETY_MARGIN;

/**
 * Estimates state + longest question tokens (JEV's 32k cap).
 * @param state - Built JEV state object.
 */
export function estimateStatePlusLongestQuestion(state: unknown): number {
  return estimateJsonTokens(state) + longestQuestionTokenEstimate();
}

/**
 * Estimates total request tokens (full JSON body).
 * @param state - Built JEV state object.
 */
export function estimateRequestTokens(state: unknown): number {
  const body = {
    state,
    model: "jev-1.13.0",
    questions: JEV_PR_QUESTIONS,
  };
  return estimateJsonTokens(body);
}

/**
 * Returns true when state + longest question fits under the JEV cap.
 * @param state - Built JEV state object.
 */
export function isStateWithinBudget(state: unknown): boolean {
  return estimateStatePlusLongestQuestion(state) <= JEV_STATE_QUESTION_TOKEN_LIMIT;
}
