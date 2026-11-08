/** Wedstrijdtitel met spaties rond streepje (Sportlink/KNZB). */
const SPACED_TEAM_SEPARATOR = /\s+[-–—]\s+/;

/** Compacte titel: tegenstander met streep direct vóór "De Rijn …". */
const COMPACT_DE_RIJN_SPLIT = /-(?=De Rijn\b)/i;

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

  const deRijnParts = trimmed.split(COMPACT_DE_RIJN_SPLIT);
  if (deRijnParts.length === 2) {
    const home = deRijnParts[0]?.trim();
    const away = deRijnParts[1]?.trim();
    if (home && away) return { home, away };
  }

  return null;
}
