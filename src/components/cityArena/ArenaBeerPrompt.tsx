"use client";

import { beerPromptText } from "./arenaHud";

/** Props for the brewery prompt. */
export type ArenaBeerPromptProps = {
  canOrderBeer: boolean;
  /** True with the touch controls, whose Instappen button reads Biertje at the tap. */
  showTouch: boolean;
};

/**
 * Live Dutch prompt shown only while the player stands at the brewery's tap. It sits under the
 * zone warning — which shares the brewery's corner of the map, since the tap is just outside the
 * Rhenen disc — and clear of the radar on the right.
 */
export default function ArenaBeerPrompt({
  canOrderBeer,
  showTouch,
}: ArenaBeerPromptProps): React.JSX.Element | null {
  if (!canOrderBeer) return null;
  return (
    <div
      data-testid="arena-beer-prompt"
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute top-10 right-28 left-3 text-sm font-bold text-[#f5c542]"
    >
      {beerPromptText(showTouch)}
    </div>
  );
}
