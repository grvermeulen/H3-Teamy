import type { Metadata } from "next";

/** Longest preview text WhatsApp and other link previews get from a report. */
export const MATCH_REPORT_PREVIEW_MAX_CHARS = 160;

const MATCH_REPORT_TITLE = "Wedstrijdverslag De Rijn Heren 3";
const ELLIPSIS = "…";

function previewText(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length <= MATCH_REPORT_PREVIEW_MAX_CHARS) return flat;
  const room = flat.slice(0, MATCH_REPORT_PREVIEW_MAX_CHARS - ELLIPSIS.length);
  const lastSpace = room.lastIndexOf(" ");
  const cut = lastSpace > 0 ? room.slice(0, lastSpace) : room;
  return `${cut}${ELLIPSIS}`;
}

/**
 * Page metadata for a match report, so a shared link shows a preview card with
 * a title and the report's opening lines.
 *
 * @param content - Full report text.
 */
export function buildMatchReportMetadata(content: string): Metadata {
  const description = previewText(content);
  return {
    title: MATCH_REPORT_TITLE,
    description,
    openGraph: {
      type: "article",
      title: MATCH_REPORT_TITLE,
      description,
    },
  };
}
