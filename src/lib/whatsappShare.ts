/**
 * Sharing to WhatsApp through its click-to-chat link: WhatsApp opens with the
 * text filled in and the user picks the chat (the team group) and taps send.
 * Nothing is sent automatically, so no WhatsApp account is automated.
 */

const WHATSAPP_SHARE_BASE = "https://wa.me/";

/** Match details shown in the share text; each is optional. */
export type MatchReportShareInput = {
  reportUrl: string;
  opponentTeam?: string;
  ourScore?: number;
  opponentScore?: number;
};

/**
 * Builds a `wa.me` link that opens WhatsApp's chat picker with `text` filled in.
 *
 * @param text - Message to prefill; any characters are allowed.
 * @returns Absolute `https://wa.me/?text=…` URL.
 */
export function buildWhatsAppShareUrl(text: string): string {
  return `${WHATSAPP_SHARE_BASE}?text=${encodeURIComponent(text)}`;
}

/**
 * Absolute link to a match report page.
 *
 * @param origin - Site origin without trailing slash, e.g. `https://h3.example`.
 * @param eventId - Event id of the match; escaped for use in a path.
 */
export function buildMatchReportUrl(origin: string, eventId: string): string {
  return `${origin}/report/${encodeURIComponent(eventId)}`;
}

/**
 * Dutch share text for a match report, naming the opponent and score when known.
 *
 * @param input - Report URL plus optional opponent and both scores; a score is
 *   only shown when both sides are numbers.
 */
export function buildMatchReportShareText(
  input: MatchReportShareInput,
): string {
  const hasScore =
    typeof input.ourScore === "number" &&
    typeof input.opponentScore === "number";
  const scorePart = hasScore
    ? ` (${input.ourScore}-${input.opponentScore})`
    : "";
  const opponentPart = input.opponentTeam ? ` tegen ${input.opponentTeam}` : "";
  return `Wedstrijdverslag van De Rijn Heren 3${opponentPart} staat klaar${scorePart}. Lees het hier: ${input.reportUrl}`;
}
