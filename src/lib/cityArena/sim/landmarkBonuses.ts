import type { ArenaPlayerState } from "./types";

/** Stable wire order for temporary landmark bonuses; append new kinds. */
export const BONUS_KINDS = [
  "speed",
  "guard",
  "recovery",
  "focus",
  "power",
] as const;
/** The stat improved by a visit. */
export type BonusKind = (typeof BONUS_KINDS)[number];
/** One bonus at a time, followed by a short rest before the next activity. */
export type LandmarkBonus = {
  kind: BonusKind;
  untilTick: number;
  readyAtTick: number;
};
/** Dutch labels and exact gameplay effects shared by prompts and the HUD. */
export const BONUS_INFO: Record<
  BonusKind,
  { name: string; detail: string; colour: string }
> = {
  speed: {
    name: "Frisse benen",
    detail: "+25% loopsnelheid",
    colour: "#65dacb",
  },
  guard: {
    name: "Beschermengel",
    detail: "25% minder schade",
    colour: "#e9c878",
  },
  recovery: {
    name: "Tweede adem",
    detail: "+2 gezondheid per seconde",
    colour: "#96d785",
  },
  focus: {
    name: "Scherpe focus",
    detail: "20% kortere schietpauze",
    colour: "#9bbcf5",
  },
  power: { name: "Spierkracht", detail: "+25% slagkracht", colour: "#f0a16c" },
};
/** Returns the active stat, excluding dead players and expired bonuses. */
export function activeBonus(
  player: Pick<ArenaPlayerState, "bonus" | "diedAtTick">,
  tick: number,
): BonusKind | null {
  return player.diedAtTick === null &&
    player.bonus &&
    tick < player.bonus.untilTick
    ? player.bonus.kind
    : null;
}
/** The same walking multiplier is used by the host and client prediction. */
export function landmarkSpeedFactor(
  player: ArenaPlayerState,
  tick: number,
): number {
  return activeBonus(player, tick) === "speed" ? 1.25 : 1;
}
