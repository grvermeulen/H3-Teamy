"use client";

/** Props for {@link ArenaTouchTip}. */
export type ArenaTouchTipProps = {
  /** Which right-hand control the tip describes: the aim stick, or the buttons. */
  twinStick: boolean;
  /** The 3D layout on touch — look pad, Schieten, Richten — whatever the 2D one. */
  look3d?: boolean;
  onDismiss: () => void;
};

/** The tip for each layout (spec §7, §16) and the button that puts it away. */
export const TWIN_STICK_TIP =
  "Links slepen om te lopen of te sturen · rechts slepen om te richten en te schieten.";
export const SINGLE_STICK_TIP =
  "Links slepen om te lopen of te sturen · rechts: Schieten, Instappen, Wapen.";
export const LOOK_PAD_TIP =
  "Links slepen om te lopen of te sturen · rechts slepen om rond te kijken · houd Schieten vast om te schieten · Richten zoomt in.";
export const DISMISS_LABEL = "Begrepen";

/** The tip's text for a layout. */
function tipText(twinStick: boolean, look3d: boolean): string {
  if (look3d) return LOOK_PAD_TIP;
  return twinStick ? TWIN_STICK_TIP : SINGLE_STICK_TIP;
}

/**
 * The first-run tip for touch controls, shown once per layout family — 2D, and 3D's look pad —
 * (spec §9.3 keeps the flag in local storage).
 *
 * @param props - The layout it explains and what to do when it is read.
 * @returns The tip.
 */
export function ArenaTouchTip({
  twinStick,
  look3d = false,
  onDismiss,
}: ArenaTouchTipProps): React.JSX.Element {
  return (
    <div
      role="note"
      className="absolute inset-x-3 top-3 z-20 flex flex-wrap items-center justify-between gap-2 border border-[var(--arena-line-strong)] bg-[var(--arena-panel)] px-3 py-2 text-[12px] text-[var(--arena-text)]"
    >
      <span>{tipText(twinStick, look3d)}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="arena-label bg-[var(--arena-amber)] px-3 py-2 text-[var(--arena-void)]"
      >
        {DISMISS_LABEL}
      </button>
    </div>
  );
}
