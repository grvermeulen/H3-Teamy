/** Wedstrijdtitel met spaties rond streepje (Sportlink/KNZB). */
const SPACED_TEAM_SEPARATOR = /\s+[-–—]\s+/;

/** Compacte titel: streep vóór bekende clubprefix (De Rijn / ENC / …). */
const COMPACT_AWAY_SPLIT = /-(?=(?:De Rijn|ENC|NDD|PFC)\b)/i;

export type MatchTitleTeams = { home: string; away: string };

/**
 * Parseert thuis/uit-team uit een kalenderwedstrijdtitel.
 * Ondersteunt `Team A - Team B` en compacte varianten zoals `PFC Rheden H2-De Rijn H3`.
 */
export function extractTeamsFromEventTitle(
  title?: string | null,
): MatchTitleTeams | null {
  const trimmed = (title ?? "").trim();
  if (!trimmed) return null;

  if (SPACED_TEAM_SEPARATOR.test(trimmed)) {
    const parts = trimmed.split(SPACED_TEAM_SEPARATOR);
    if (parts.length >= 2) {
      const home = parts[0]?.trim();
      const away = parts.slice(1).join(" - ").trim();
      if (home && away) return { home, away };
    }
  }

  const compactParts = trimmed.split(COMPACT_AWAY_SPLIT);
  if (compactParts.length === 2) {
    const home = compactParts[0]?.trim();
    const away = compactParts[1]?.trim();
    if (home && away) return { home, away };
  }

  return null;
}
