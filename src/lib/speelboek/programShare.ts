/** One drill line in a shared training programme. */
export type ProgramShareItem = {
  drillId: string;
  title: string;
  minutes?: number;
};

/** Everything needed to write the programme message. */
export type ProgramShareInput = {
  /** Site origin without trailing slash. */
  appUrl: string;
  /** Human label for the training date, e.g. `"vanavond"` or `"woensdag"`. */
  dayLabel: string;
  items: ProgramShareItem[];
};

/**
 * Dutch WhatsApp text for a training programme: each drill with its duration
 * and a deep link into the speelboek, then a link to the whole speelboek.
 *
 * @param input - Site origin, day label and the programme's drills in order.
 */
export function buildProgramShareText(input: ProgramShareInput): string {
  const lines = input.items.map((item) => {
    const minutes = item.minutes ? ` (${item.minutes} min)` : "";
    return `• ${item.title}${minutes} – ${input.appUrl}/speelboek/${item.drillId}`;
  });
  return [
    `Training ${input.dayLabel}: dit gaan we oefenen`,
    ...lines,
    "",
    `Bekijk alles in het speelboek: ${input.appUrl}/speelboek`,
  ].join("\n");
}
