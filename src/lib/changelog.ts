export type TourStep = {
  title: string;
  body: string;
  /** CSS selector to spotlight; if omitted, the step is centered with no anchor. */
  target?: string;
};

export type ChangelogEntry = {
  title: string;
  steps: TourStep[];
};

export const CHANGELOG: Record<string, ChangelogEntry> = {
  "0.2.0": {
    title: "What's new in 0.2.0",
    steps: [
      {
        title: "Tell us when something's broken",
        body: "Tap the 💬 button (bottom-right) any time to file a quick bug report.",
        target: "[data-tour='feedback-fab']",
      },
      {
        title: "Pitch a feature idea",
        body: "Same 💬 button — switch to the Idea tab. We bundle the best ones into a weekly review.",
        target: "[data-tour='feedback-fab']",
      },
      {
        title: "Know your version",
        body: "Your app version now lives at the bottom of the Profile page. Helpful when reporting bugs.",
        target: "[data-tour='profile-version']",
      },
    ],
  },
};

export function getChangelogEntry(version: string): ChangelogEntry | null {
  return CHANGELOG[version] ?? null;
}
