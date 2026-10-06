import type { JevAnswer, JevScoreAnswer } from "./types";

const SEVERITY_NL: Record<string, string> = {
  None: "Geen",
  Minor: "Klein",
  Moderate: "Matig",
  Severe: "Ernstig",
};

/**
 * Formats a noul answer as Dutch ja/nee with the probability of that answer.
 * @param answer - JEV noul answer (noul = P(true per question criteria)).
 */
export function formatNoulAnswer(answer: JevAnswer | undefined): string {
  if (!answer || answer.type !== "noul") {
    return "—";
  }
  const isYes = answer.noul >= 0.5;
  const probability = isYes ? answer.noul : 1 - answer.noul;
  return `${isYes ? "ja" : "nee"} (kans ${(probability * 100).toFixed(0)}%)`;
}

/**
 * Formats a noul flag line with label prefix.
 * @param label - Dutch label for the flag.
 * @param answer - JEV noul answer.
 */
export function formatNoulFlagLine(
  label: string,
  answer: JevAnswer | undefined,
): string {
  return `${label}: ${formatNoulAnswer(answer)}`;
}

/**
 * Returns the Dutch severity label nearest to the weighted score index.
 * @param answer - JEV score answer with legend map.
 */
export function formatSeverityAnswer(answer: JevScoreAnswer): string {
  const indices = Object.keys(answer.legend)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);

  if (indices.length === 0) {
    return `score ${answer.score.toFixed(2)}`;
  }

  const rounded = Math.round(answer.score);
  const clamped = Math.max(
    indices[0],
    Math.min(indices[indices.length - 1], rounded),
  );
  const english = answer.legend[String(clamped)] ?? answer.legend[String(indices[0])];
  const dutch = SEVERITY_NL[english] ?? english;

  return `**${dutch}** (score ${answer.score.toFixed(2)}, vertrouwen ${(answer.confidence * 100).toFixed(0)}%)`;
}

/**
 * Returns true when a noul answer is affirmative (P(true) >= 0.5).
 * @param answer - JEV noul answer.
 */
export function isNoulYes(answer: JevAnswer | undefined): boolean {
  return answer?.type === "noul" && answer.noul >= 0.5;
}
