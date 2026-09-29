/** The two fighters. Staal starts on the left, Trump on the right. */
export type FighterId = "staal" | "trump";

/** +1 faces right (towards larger x), -1 faces left. */
export type Facing = 1 | -1;

/** What a hand is doing: a fist, an open palm, a pointing finger, a thumbs-up or a grip on a can. */
export type HandShape = "fist" | "open" | "point" | "thumb" | "grip";

/** Facial expressions the head renderers know. */
export type Expression =
  | "calm"
  | "smirk"
  | "grit"
  | "shout"
  | "hurt"
  | "dizzy"
  | "smug"
  | "angry"
  | "drink"
  | "aah"
  | "ko"
  | "worried";

/** Body points a hit, a projectile or an effect can be anchored to. */
export type Limb =
  | "handF"
  | "handB"
  | "footF"
  | "footB"
  | "kneeF"
  | "elbowF"
  | "head"
  | "mouth"
  | "chest"
  | "hip";

/** Where Staal's sunglasses sit. */
export type ShadesState = "on" | "askew" | "down";

/** Where Staal's celebration beer is. */
export type CanState = "none" | "closed" | "open" | "crushed";

/** Per-fighter props that change over the fight and are not part of a pose. */
export type Props = {
  shades: ShadesState;
  can: CanState;
  /** 0 = can upright in the hand, 1 = tipped to the mouth. */
  canTilt: number;
  /** 0 = the tie hangs, 1 = fully cracked out like a whip. */
  tieWhip: number;
  /** 0 = hair in place, 1 = blown right up. */
  hairLift: number;
  /** Dizzy stars circling the head. */
  stars: boolean;
};
