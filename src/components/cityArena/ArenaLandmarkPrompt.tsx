"use client";

import type { ArenaHud } from "./arenaHud";

interface ArenaLandmarkPromptProps extends Pick<
  ArenaHud,
  "landmark" | "bonus"
> {
  showTouch: boolean;
}

/** Activity instructions and a persistent timer for the player's temporary stat bonus. */
export default function ArenaLandmarkPrompt({
  landmark,
  bonus,
  showTouch,
}: ArenaLandmarkPromptProps): React.JSX.Element | null {
  if (!landmark && !bonus) return null;
  return (
    <div className="pointer-events-none absolute left-3 right-28 top-12 z-10 flex max-w-sm flex-col gap-2 text-xs">
      {bonus ? (
        <div
          className={`rounded-lg border bg-[#101b20]/95 px-3 py-2 ${bonus.borderClass}`}
        >
          <strong className={bonus.textClass}>{bonus.name}</strong>
          <span
            className="float-right tabular-nums text-white"
            aria-label="Resterende bonustijd"
          >
            {bonus.seconds} s
          </span>
          <p className="mt-1 text-white/80 [@media(max-height:500px)]:hidden">
            {bonus.detail}
          </p>
        </div>
      ) : null}
      {landmark ? (
        <div className="rounded-lg border border-[#6b8d81] bg-[#101b20]/95 p-3 text-white">
          <p
            role="status"
            className="text-[10px] uppercase tracking-widest text-[#98c7b1]"
          >
            {landmark.name}
          </p>
          <p className="mt-1 font-bold">
            {landmark.cooldown > 0
              ? `Even uitrusten · ${landmark.cooldown} s`
              : `${showTouch ? "Tik" : "E / controller B"} · ${landmark.action}`}
          </p>
          <p className="mt-1 text-white/70 [@media(max-height:500px)]:hidden">
            {landmark.description}
          </p>
          <p className="mt-2 text-[#bfe6ca]">{landmark.reward}</p>
        </div>
      ) : null}
    </div>
  );
}
