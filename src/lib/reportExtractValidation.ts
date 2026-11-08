import type { MatchTitleTeams } from "./matchTitleTeams";

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type ExtractedMatchResult = {
  homeTeam?: string | null;
  awayTeam?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  events?: unknown[] | null;
};

function teamTokens(name: string): string[] {
  return normalizeName(name).split(" ").filter(Boolean);
}

/** Of twee teamnamen plausibel hetzelfde team zijn (OCR-variatie toegestaan). */
export function teamNamesLikelyMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = teamTokens(a);
  const tb = teamTokens(b);
  const overlap = ta.filter((t) => tb.includes(t));
  return overlap.length >= Math.min(2, Math.min(ta.length, tb.length));
}

export function extractHasScoresAndEvents(result: ExtractedMatchResult): boolean {
  const hasScores =
    typeof result.homeScore === "number" &&
    typeof result.awayScore === "number";
  const hasEvents =
    Array.isArray(result.events) && result.events.length > 0;
  return hasScores && hasEvents;
}

/**
 * Detecteert of OCR-teamnamen niet bij de geselecteerde kalenderwedstrijd passen.
 */
export function extractedTeamsMismatchFixture(
  titleTeams: MatchTitleTeams | null,
  result: ExtractedMatchResult,
): boolean {
  if (!titleTeams?.home || !titleTeams?.away) return false;
  const home = (result.homeTeam ?? "").trim();
  const away = (result.awayTeam ?? "").trim();
  if (!home || !away) return false;

  const titleNames = [titleTeams.home, titleTeams.away];
  const extractNames = [home, away];

  let matched = 0;
  for (const en of extractNames) {
    if (titleNames.some((tn) => teamNamesLikelyMatch(tn, en))) matched += 1;
  }
  return matched < 2;
}
