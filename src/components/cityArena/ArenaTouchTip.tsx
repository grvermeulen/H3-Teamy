"use client";

/** Props for {@link ArenaTouchTip}. */
export type ArenaTouchTipProps = {
  /** Which right-hand control the tip describes: the aim stick, or the buttons. */
  twinStick: boolean;
  onDismiss: () => void;
};

/** The tip for each layout (spec §7, §16) and the button that puts it away. */
export const TWIN_STICK_TIP =
  "Links slepen om te lopen of te sturen · rechts slepen om te richten en te schieten.";
export const SINGLE_STICK_TIP =
  "Links slepen om te lopen of te sturen · rechts: Schieten, Instappen, Wapen.";
export const DISMISS_LABEL = "Begrepen";

/**
 * The first-run tip for touch controls, shown once (spec §9.3 keeps the flag in local storage).
 *
 * @param props - The layout it explains and what to do when it is read.
 * @returns The tip.
 */
export function ArenaTouchTip({
  twinStick,
  onDismiss,
}: ArenaTouchTipProps): React.JSX.Element {
  return (
    <div
      role="note"
      className="absolute inset-x-3 top-3 z-20 flex flex-wrap items-center justify-between gap-2 border border-[var(--arena-line-strong)] bg-[var(--arena-panel)] px-3 py-2 text-[12px] text-[var(--arena-text)]"
    >
      <span>{twinStick ? TWIN_STICK_TIP : SINGLE_STICK_TIP}</span>
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
