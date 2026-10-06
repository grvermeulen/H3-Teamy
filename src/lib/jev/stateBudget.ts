import { JEV_PR_QUESTIONS } from "./questions";

/** JEV limit: state + longest question must stay under 32k tokens. */
export const JEV_STATE_QUESTION_TOKEN_LIMIT = 32_000;

/** Reserved tokens for the questions block (longest question headroom). */
export const QUESTION_TOKEN_RESERVE = 4_000;

/** Max tokens for the serialized state object. */
export const MAX_STATE_TOKENS =
  JEV_STATE_QUESTION_TOKEN_LIMIT - QUESTION_TOKEN_RESERVE;

/** Approximate token count from character length (chars / 4). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimates tokens for a JSON-serializable value. */
export function estimateJsonTokens(value: unknown): number {
  return estimateTokens(JSON.stringify(value));
}

/**
 * Estimates total request tokens (state + questions + model field overhead).
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
 * Returns true when the state fits under the state+question token cap.
 * @param state - Built JEV state object.
 */
export function isStateWithinBudget(state: unknown): boolean {
  return estimateJsonTokens(state) <= MAX_STATE_TOKENS;
}

/** Safety margin reserved for truncation_note and JSON overhead. */
export const STATE_TOKEN_SAFETY_MARGIN = 200;
