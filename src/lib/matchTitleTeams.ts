const DASH_CHARS = new Set(["-", "–", "—"]);

/** Bekende compacte scheiding vóór uitteam (zonder regex i.v.m. CodeQL ReDoS). */
const COMPACT_AWAY_PREFIXES = ["De Rijn", "ENC", "NDD", "PFC"] as const;

export type MatchTitleTeams = { home: string; away: string };

function isAsciiSpace(ch: string): boolean {
  return ch === " " || ch === "\t";
}

function splitSpacedTitle(title: string): MatchTitleTeams | null {
  const n = title.length;
  for (let i = 0; i < n; i++) {
    if (!isAsciiSpace(title[i]!)) continue;
    const wsStart = i;
    while (i < n && isAsciiSpace(title[i]!)) i++;
    if (i >= n) break;
    const dash = title[i]!;
    if (!DASH_CHARS.has(dash)) {
      i = wsStart;
      continue;
    }
    i += 1;
    while (i < n && isAsciiSpace(title[i]!)) i++;
    if (i >= n) break;
    const home = title.slice(0, wsStart).trim();
    const away = title.slice(i).trim();
    if (home && away) return { home, away };
  }
  return null;
}

function startsWithPrefixInsensitive(haystack: string, prefix: string): boolean {
  if (haystack.length < prefix.length) return false;
  return (
    haystack.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()
  );
}

function splitCompactTitle(title: string): MatchTitleTeams | null {
  for (let i = 0; i < title.length; i++) {
    if (title[i] !== "-") continue;
    const after = title.slice(i + 1);
    for (const prefix of COMPACT_AWAY_PREFIXES) {
      if (!startsWithPrefixInsensitive(after, prefix)) continue;
      const next = after[prefix.length];
      if (next !== undefined && next !== " " && /[A-Za-z0-9]/.test(next)) {
        continue;
      }
      const home = title.slice(0, i).trim();
      const away = after.trim();
      if (home && away) return { home, away };
    }
  }
  return null;
}

/**
 * Parseert thuis/uit-team uit een kalenderwedstrijdtitel.
 * Ondersteunt `Team A - Team B` en compacte varianten zoals `PFC Rheden H2-De Rijn H3`.
 */
export function extractTeamsFromEventTitle(
  title?: string | null,
): MatchTitleTeams | null {
  const trimmed = (title ?? "").trim();
  if (!trimmed || trimmed.length > 256) return null;

  const spaced = splitSpacedTitle(trimmed);
  if (spaced) return spaced;

  return splitCompactTitle(trimmed);
}
