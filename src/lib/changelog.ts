/**
 * One step in the What's-new feature tour. The `target` is optional — when set,
 * the overlay draws a spotlight box around the matching DOM element.
 */
export type TourStep = {
  title: string;
  body: string;
  /** CSS selector to spotlight; if omitted, the step is centered with no anchor. */
  target?: string;
};

/**
 * The full What's-new payload for a single app version: a header title and the
 * ordered list of steps to walk the user through.
 */
export type ChangelogEntry = {
  title: string;
  steps: TourStep[];
};

/**
 * Map of app versions -> tour content. A user is shown the entry for the
 * current `APP_VERSION` once, then `User.lastVersionSeen` is updated so it
 * doesn't reappear. Versions without an entry never trigger the tour.
 */
export const CHANGELOG: Record<string, ChangelogEntry> = {
  "0.2.0": {
    title: "Wat is er nieuw in 0.2.0",
    steps: [
      {
        title: "Laat het weten als iets stuk is",
        body: "Tik rechtsonder op de 💬-knop om snel een bug te melden.",
        target: "[data-tour='feedback-fab']",
      },
      {
        title: "Tip een nieuw idee",
        body: "Dezelfde 💬-knop — kies het tabblad Idee. We bundelen de beste tips in een wekelijks overzicht.",
        target: "[data-tour='feedback-fab']",
      },
      {
        title: "Zie welke versie je hebt",
        body: "De app-versie staat nu onderaan je Profielpagina. Handig bij het melden van bugs.",
        target: "[data-tour='profile-version']",
      },
    ],
  },
};

/**
 * Returns the tour entry for a specific app version, or `null` if no tour has
 * been authored for that version.
 *
 * @param version - The app version to look up (e.g. `"0.2.0"`).
 */
export function getChangelogEntry(version: string): ChangelogEntry | null {
  return CHANGELOG[version] ?? null;
}
