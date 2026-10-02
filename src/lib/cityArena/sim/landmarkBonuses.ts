import type { ArenaPlayerState } from "./types";

/** Shared balance values for every host-side landmark effect. */
export const BONUS_BALANCE = {
  restSeconds: 15,
  recoveryPerSecond: 2,
  speedFactor: 1.25,
  meleeFactor: 1.25,
  shotCooldownFactor: 0.8,
  damageFactor: 0.75,
} as const;

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
  {
    name: string;
    detail: string;
    colour: string;
    borderClass: string;
    textClass: string;
  }
> = {
  speed: {
    name: "Frisse benen",
    detail: "+25% loopsnelheid",
    colour: "#65dacb",
    borderClass: "border-[#65dacb]",
    textClass: "text-[#65dacb]",
  },
  guard: {
    name: "Beschermengel",
    detail: "25% minder schade",
    colour: "#e9c878",
    borderClass: "border-[#e9c878]",
    textClass: "text-[#e9c878]",
  },
  recovery: {
    name: "Tweede adem",
    detail: "+2 gezondheid per seconde",
    colour: "#96d785",
    borderClass: "border-[#96d785]",
    textClass: "text-[#96d785]",
  },
  focus: {
    name: "Scherpe focus",
    detail: "20% kortere schietpauze",
    colour: "#9bbcf5",
    borderClass: "border-[#9bbcf5]",
    textClass: "text-[#9bbcf5]",
  },
  power: {
    name: "Spierkracht",
    detail: "+25% slagkracht",
    colour: "#f0a16c",
    borderClass: "border-[#f0a16c]",
    textClass: "text-[#f0a16c]",
  },
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
  return activeBonus(player, tick) === "speed" ? BONUS_BALANCE.speedFactor : 1;
}
