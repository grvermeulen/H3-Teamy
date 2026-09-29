import { ScriptBuilder, type FightScript } from "./script";

/** Where the fighters stand when the stage appears. */
const START = { staal: 560, trump: 840 } as const;

/** World x of the beach bar's front, where the finisher sends Trump. */
export const BAR_X = 1450;

/** Colours for the small callouts next to the action. */
const GOLD = "#ffd24a";
const STEEL = "#8fe3ff";
const HOT = "#ff7a3d";

/**
 * The fight, beat by beat: a versus screen, Trump's cheap opening, a parried "Je bent
 * ontslagen!", two Staal combos (the second one 21 hits), a super with a slow-motion finishing
 * uppercut, and a well-earned beer.
 *
 * @returns The script. Build it once; it is plain data.
 */
export function buildFightScript(): FightScript {
  const b = new ScriptBuilder({ ...START }, 3.0);
  const staalHead = { who: "staal", limb: "head" } as const;
  const trumpHead = { who: "trump", limb: "head" } as const;
  const trumpChest = { who: "trump", limb: "chest" } as const;
  const staalHand = { who: "staal", limb: "handF" } as const;
  const staalBack = { who: "staal", limb: "handB" } as const;
  const staalFoot = { who: "staal", limb: "footF" } as const;
  const staalKnee = { who: "staal", limb: "kneeF" } as const;
  const staalElbow = { who: "staal", limb: "elbowF" } as const;

  // ── Versus screen ──────────────────────────────────────────────────────────
  b.sfx(0.15, "whoosh", 0.9);
  b.sfx(0.75, "vs-sting");
  b.sfx(2.75, "teleport", 0.8);

  // ── Intro ──────────────────────────────────────────────────────────────────
  b.clip("trump", 3.3, "gloat", 1.6);
  b.cue({
    kind: "bubble",
    t: 3.4,
    dur: 1.8,
    who: "trump",
    text: "Ik ben de beste vechter. Iedereen zegt het.",
  });
  b.clip("staal", 4.9, "shades", 1.0);
  b.cue({
    kind: "bubble",
    t: 5.1,
    dur: 1.2,
    who: "staal",
    text: "Eerst zien, dan geloven.",
  });
  b.cue({ kind: "banner", t: 6.3, dur: 1.0, text: "RONDE 1", style: "round" });
  b.sfx(6.3, "bell", 1, 0.7);
  b.cue({ kind: "banner", t: 7.4, dur: 0.8, text: "VECHT!", style: "fight" });
  b.sfx(7.4, "vs-sting", 1.1);
  b.cue({ kind: "music", t: 7.4, action: "start" });
  b.cue({ kind: "hype", t: 7.4, dur: 1 });

  // ── Trump's cheap opening ──────────────────────────────────────────────────
  b.clip("trump", 8.0, "walk", 0.55, { x: 700, ease: "linear" });
  b.clip("trump", 8.55, "slap", 0.5);
  b.sfx(8.7, "whoosh", 1.1);
  b.hit(8.83, "trump", 6, "slap", { who: "trump", limb: "handF" });
  b.sfx(8.83, "punch-light", 0.9);
  b.cue({
    kind: "popup",
    t: 8.83,
    dur: 1,
    text: "EERSTE KLAP!",
    at: trumpHead,
    color: GOLD,
  });
  b.clip("staal", 8.83, "hurtHigh", 0.45, { dx: -25 });
  b.clip("trump", 9.35, "gloat", 0.9);
  b.cue({
    kind: "bubble",
    t: 9.4,
    dur: 1.0,
    who: "trump",
    text: "Zag je dat? Geweldig!",
  });
  b.clip("staal", 9.4, "crack", 0.9);
  b.sfx(10.12, "block", 1.6, 0.35);
  b.clip("trump", 10.3, "walk", 0.4, { x: 800, ease: "linear" });

  // ── "Je bent ontslagen!" — parried straight back ───────────────────────────
  b.clip("trump", 10.75, "point", 0.8);
  b.cue({
    kind: "bubble",
    t: 10.75,
    dur: 1.1,
    who: "trump",
    text: "JE BENT ONTSLAGEN!",
  });
  b.sfx(10.99, "projectile");
  const fired = b.projectile(
    "ontslagen",
    10.99,
    11.45,
    { who: "trump", limb: "handF" },
    staalHand,
  );
  b.clip("staal", 11.25, "parry", 0.42);
  b.hit(11.45, "staal", 0, "parry", { projectile: fired });
  b.sfx(11.45, "parry");
  b.cue({ kind: "flash", t: 11.45, strength: 0.35 });
  b.cue({
    kind: "popup",
    t: 11.45,
    dur: 0.9,
    text: "PARRY!",
    at: staalHead,
    color: STEEL,
  });
  const returned = b.projectile(
    "ontslagen",
    11.45,
    11.72,
    staalHand,
    trumpHead,
    { spin: 540 },
  );
  b.sfx(11.47, "projectile", 1.25);
  b.hit(11.72, "staal", 8, "projectile", { projectile: returned });
  b.sfx(11.72, "punch-heavy");
  b.sfx(11.74, "oof");
  b.clip("trump", 11.72, "hurtHigh", 0.5, { dx: 20 });
  b.cue({
    kind: "bubble",
    t: 11.6,
    dur: 1.0,
    who: "staal",
    text: "Retour afzender.",
  });

  // ── Combo 1: dash, jab, jab, cross, body, uppercut, air kick ──────────────
  b.clip("staal", 11.95, "dash", 0.3, { x: 684 });
  b.sfx(11.97, "whoosh", 0.9);
  b.burst(11.97, "dust", { who: "staal", limb: "footB" });
  const jab = (t: number, dmg: number, dx: number): void => {
    b.clip("staal", t, "jab", 0.25, { dx });
    b.sfx(t + 0.02, "whoosh", 1.25, 0.6);
    b.hit(t + 0.075, "staal", dmg, "light", staalHand);
    b.sfx(t + 0.075, "punch-light", 1 + dmg * 0.02);
    b.clip("trump", t + 0.075, "hurtHigh", 0.28, { dx: 4 });
  };
  jab(12.25, 3, 4);
  jab(12.52, 3, 4);
  b.clip("staal", 12.8, "cross", 0.3, { dx: 8 });
  b.sfx(12.82, "whoosh", 1.1);
  b.hit(12.9, "staal", 5, "heavy", staalBack);
  b.sfx(12.9, "punch-heavy");
  b.clip("trump", 12.9, "hurtHigh", 0.3, { dx: 10 });
  b.clip("staal", 13.12, "body", 0.32, { dx: 8 });
  b.hit(13.23, "staal", 5, "heavy", staalHand);
  b.sfx(13.23, "punch-heavy", 0.9);
  b.sfx(13.25, "oof", 1.05);
  b.clip("trump", 13.23, "hurtGut", 0.4, { dx: 6 });
  b.clip("staal", 13.5, "uppercut", 0.42, { dx: 40 });
  b.sfx(13.52, "kiai");
  b.hit(13.71, "staal", 7, "heavy", staalHand);
  b.sfx(13.71, "punch-heavy", 0.85);
  b.clip("trump", 13.71, "launched", 0.44, {
    dx: 50,
    y0: 0,
    y1: 120,
    arc: 30,
    spin: -30,
  });
  b.clip("staal", 13.92, "jump", 0.2, { dx: 36, y0: 0, y1: 112 });
  b.clip("staal", 14.12, "airKick", 0.3, { dx: 10, y1: 118 });
  b.sfx(14.13, "whoosh", 1.2);
  b.hit(14.225, "staal", 6, "kick", staalFoot);
  b.sfx(14.225, "kick");
  b.clip("trump", 14.225, "launched", 0.58, {
    dx: 90,
    y1: 0,
    arc: 40,
    spin: -50,
  });
  b.clip("staal", 14.42, "jump", 0.36, { dx: 20, y1: 0 });
  b.clip("staal", 14.78, "land", 0.3);
  b.burst(14.8, "dust", staalFoot);
  b.clip("trump", 14.805, "fallDown", 0.22);
  b.sfx(14.99, "slam");
  b.burst(15.0, "dust", { who: "trump", limb: "hip" });
  b.clip("trump", 15.03, "down", 0.85, { hold: true, face: "hurt" });
  b.cue({ kind: "hype", t: 14.3, dur: 1.4 });

  b.clip("staal", 15.3, "walk", 0.55, { dx: 25, ease: "linear" });
  b.clip("staal", 15.95, "beckon", 1.0);
  b.cue({
    kind: "bubble",
    t: 16.0,
    dur: 1.0,
    who: "staal",
    text: "Kom maar op.",
  });
  b.clip("trump", 15.88, "getUp", 0.7);
  b.cue({
    kind: "bubble",
    t: 16.65,
    dur: 1.0,
    who: "trump",
    text: "Nu word ik boos!",
  });

  // ── Trump's windmill, blocked, then swept ──────────────────────────────────
  b.clip("trump", 17.2, "windmill", 1.3, { dx: -84, ease: "linear" });
  b.clip("staal", 17.3, "block", 1.15, { dx: -45, ease: "linear" });
  for (const t of [17.5, 17.8, 18.1]) {
    b.sfx(t - 0.12, "whoosh", 1.3, 0.7);
    b.hit(t, "trump", 0, "block", { who: "staal", limb: "handF" });
    b.sfx(t, "block");
  }
  b.clip("staal", 18.5, "sweep", 0.5);
  b.sfx(18.52, "whoosh", 0.8);
  b.hit(18.65, "staal", 6, "kick", staalFoot);
  b.sfx(18.65, "kick", 0.9);
  b.cue({
    kind: "popup",
    t: 18.65,
    dur: 1,
    text: "COUNTER!",
    at: staalHead,
    color: HOT,
  });
  b.clip("trump", 18.65, "launched", 0.35, { dx: 10, arc: 40, spin: -30 });
  b.clip("trump", 19.0, "fallDown", 0.2);
  b.sfx(19.18, "slam");
  b.burst(19.2, "dust", { who: "trump", limb: "hip" });
  b.clip("trump", 19.2, "down", 0.6, { hold: true, face: "hurt" });
  b.clip("staal", 19.4, "crack", 0.9);
  b.clip("trump", 19.8, "getUp", 0.7);
  b.cue({
    kind: "bubble",
    t: 20.4,
    dur: 1.0,
    who: "trump",
    text: "Oneerlijk! Heel oneerlijk!",
  });

  // ── The tie whip lands; Staal is not impressed ─────────────────────────────
  b.clip("trump", 20.5, "walk", 0.4, { dx: 55, ease: "linear" });
  b.clip("trump", 20.95, "tieWhip", 0.9);
  b.sfx(21.2, "whoosh", 0.8);
  b.hit(21.33, "trump", 9, "whip", staalHead);
  b.sfx(21.33, "punch-heavy", 1.15);
  b.clip("staal", 21.33, "hurtHigh", 0.5, { dx: -30 });
  b.prop(21.33, "staal", "shades", "askew");
  b.clip("trump", 21.95, "gloat", 1.0);
  b.cue({
    kind: "bubble",
    t: 21.95,
    dur: 1.1,
    who: "trump",
    text: "Enorm! Ongelooflijk enorm!",
  });
  b.clip("trump", 23.0, "walk", 0.5, { dx: 40, ease: "linear" });
  b.clip("staal", 22.15, "shades", 0.9);
  b.prop(22.5, "staal", "shades", "on");
  b.clip("staal", 23.1, "shadesDown", 1.55);
  b.prop(23.35, "staal", "shades", "down");
  b.prop(24.5, "staal", "shades", "on");
  b.cue({
    kind: "bubble",
    t: 23.4,
    dur: 1.2,
    who: "staal",
    text: "Is dat alles?",
  });
  b.cue({
    kind: "cam",
    t: 23.1,
    dur: 1.6,
    zoom: 1.35,
    focus: "staal",
    ramp: 0.3,
  });

  // ── Combo 2: 21 hits ───────────────────────────────────────────────────────
  b.clip("staal", 24.7, "dash", 0.24, {
    x: b.xOf("trump") - 132,
    ghost: true,
  });
  b.sfx(24.7, "teleport");
  b.sfx(24.74, "kiai", 1.05);
  b.clip("staal", 24.95, "rush", 1.2, { dx: 34, ghost: true, ease: "linear" });
  b.clip("trump", 24.97, "shaken", 1.2, { dx: 34, ease: "linear" });
  for (let i = 0; i < 12; i++) {
    const t = 25.0 + i * 0.1;
    b.hit(t, "staal", 0.75, "light", i % 2 === 0 ? staalHand : staalBack, {
      stop: 0.02,
      shake: 3,
    });
    b.sfx(t, "punch-light", 0.92 + (i % 4) * 0.06, 0.8);
  }
  b.sfx(25.0, "rush");
  b.sfx(25.5, "rush", 1.08);
  b.sfx(25.95, "rush", 0.95);
  b.cue({
    kind: "popup",
    t: 25.3,
    dur: 0.9,
    text: "PATS PATS PATS!",
    at: trumpHead,
    color: GOLD,
  });
  b.clip("staal", 26.2, "knee", 0.35, { dx: 36 });
  b.hit(26.32, "staal", 3, "heavy", staalKnee);
  b.sfx(26.32, "punch-heavy", 0.95);
  b.sfx(26.34, "oof", 0.95);
  b.clip("trump", 26.32, "hurtGut", 0.3, { dx: 6 });
  b.clip("staal", 26.55, "elbow", 0.3, { dx: 6 });
  b.hit(26.655, "staal", 3, "heavy", staalElbow);
  b.sfx(26.655, "punch-heavy", 1.1);
  b.clip("trump", 26.66, "hurtHigh", 0.3, { dx: 8 });
  b.clip("staal", 26.92, "roundhouse", 0.45);
  b.sfx(26.98, "whoosh", 0.85);
  b.hit(27.145, "staal", 4, "kick", { who: "staal", limb: "footB" });
  b.sfx(27.145, "kick");
  b.clip("trump", 27.15, "hurtHigh", 0.32, { dx: 16 });
  b.clip("staal", 27.45, "launcher", 0.5, { dx: 16 });
  b.sfx(27.47, "kiai", 0.95);
  b.hit(27.675, "staal", 4, "heavy", staalHand);
  b.sfx(27.675, "punch-heavy", 0.8);
  b.cue({
    kind: "popup",
    t: 27.68,
    dur: 1.0,
    text: "STAALSCHOP!",
    at: staalHead,
    color: STEEL,
  });
  b.clip("trump", 27.68, "launched", 0.5, {
    dx: 40,
    y0: 0,
    y1: 170,
    arc: 30,
    spin: -40,
  });
  b.clip("staal", 27.95, "jump", 0.15, { dx: 40, y1: 170 });
  b.clip("staal", 28.1, "airKick", 0.25, { dx: 6, y1: 172 });
  b.hit(28.19, "staal", 2, "kick", staalFoot);
  b.sfx(28.19, "kick", 1.1);
  b.clip("staal", 28.35, "airKick", 0.25, { dx: 6, y1: 174 });
  b.hit(28.44, "staal", 2, "kick", staalFoot);
  b.sfx(28.44, "kick", 1.2);
  b.clip("staal", 28.6, "airPunch", 0.22, { dx: 20, y1: 190 });
  b.hit(28.68, "staal", 2, "heavy", staalHand);
  b.sfx(28.68, "punch-heavy", 1.1);
  b.clip("trump", 28.19, "launched", 0.8, {
    dx: 24,
    y1: 150,
    arc: 10,
    ease: "linear",
  });
  b.clip("staal", 28.84, "axeKick", 0.36, { y1: 196 });
  b.sfx(28.86, "whoosh", 0.7);
  b.hit(28.99, "staal", 3, "kick", staalFoot, { shake: 12 });
  b.sfx(28.99, "kick", 0.8);
  b.clip("trump", 28.99, "fallDown", 0.22, { dx: 10, y1: 0, ease: "in" });
  b.clip("trump", 29.21, "bounce", 0.36, { arc: 45, dx: 12 });
  b.sfx(29.21, "slam", 0.9);
  b.burst(29.22, "dust", { who: "trump", limb: "hip" });
  b.burst(29.22, "debris", { who: "trump", limb: "hip" });
  b.clip("trump", 29.57, "down", 0.4, { hold: true, face: "hurt" });
  b.clip("staal", 29.2, "jump", 0.3, { y1: 0 });
  b.clip("staal", 29.5, "land", 0.25);
  b.clip("staal", 29.78, "sweep", 0.45, { dx: 20 });
  b.hit(29.915, "staal", 3, "kick", staalFoot);
  b.sfx(29.915, "kick", 0.95);
  b.clip("trump", 29.97, "down", 0.6, {
    dx: 60,
    hold: true,
    face: "hurt",
  });
  b.burst(30.0, "dust", { who: "trump", limb: "hip" });
  b.burst(30.3, "dust", { who: "trump", limb: "hip" });
  b.cue({ kind: "hype", t: 29.9, dur: 2 });
  b.sfx(30.2, "crowd", 1, 0.6);
  // Staal backs off to give the super room to travel.
  b.clip("staal", 30.5, "walk", 1.1, {
    x: b.xOf("trump") - 290,
    ease: "inOut",
  });

  b.clip("trump", 31.2, "getUp", 0.9);
  b.clip("trump", 32.1, "dizzy", 2.6, { hold: true });
  b.sfx(32.2, "dizzy", 1, 0.8);
  b.cue({
    kind: "bubble",
    t: 32.3,
    dur: 1.2,
    who: "trump",
    text: "Ik wil... mijn advocaat...",
  });

  // ── Super: STAALKRACHT ────────────────────────────────────────────────────
  b.cue({ kind: "superFreeze", t: 33.0, dur: 1.4, text: "STAALKRACHT" });
  b.cue({ kind: "music", t: 33.0, action: "duck" });
  b.sfx(33.0, "super-charge");
  b.sfx(33.15, "kiai", 0.9);
  b.cue({ kind: "flash", t: 33.0, strength: 0.5 });
  b.clip("staal", 33.0, "powerUp", 1.4, { aura: true, hold: true });
  b.burst(33.1, "embers", { who: "staal", limb: "chest" });
  b.burst(33.6, "embers", { who: "staal", limb: "chest" });
  b.cue({ kind: "music", t: 34.4, action: "unduck" });

  b.clip("staal", 34.4, "dash", 0.2, {
    x: b.xOf("trump") - 130,
    ghost: true,
    aura: true,
  });
  b.sfx(34.4, "teleport");
  b.clip("staal", 34.6, "rush", 0.52, { dx: 12, ghost: true, aura: true });
  b.clip("trump", 34.62, "shaken", 0.55, { dx: 12, ease: "linear" });
  for (let i = 0; i < 5; i++) {
    const t = 34.65 + i * 0.1;
    b.hit(t, "staal", 1, "super", i % 2 === 0 ? staalHand : staalBack, {
      stop: 0.03,
    });
    b.sfx(t, "punch-heavy", 1 + i * 0.04, 0.9);
  }
  b.sfx(34.66, "rush", 1.1);
  b.clip("staal", 35.12, "knee", 0.28, { dx: 40, ghost: true, aura: true });
  b.hit(35.22, "staal", 2, "super", staalKnee);
  b.sfx(35.22, "super-hit", 1.3, 0.7);
  b.clip("trump", 35.22, "hurtGut", 0.3, { dx: 6 });
  b.clip("staal", 35.4, "roundhouse", 0.4, { ghost: true, aura: true });
  b.hit(35.6, "staal", 3, "super", { who: "staal", limb: "footB" });
  b.sfx(35.6, "kick", 0.85);
  b.clip("trump", 35.6, "hurtHigh", 0.52, { dx: 10 });

  // ── The finisher, in slow motion ───────────────────────────────────────────
  const dealt = b.damageDealt("staal");
  b.clip("staal", 35.85, "launcher", 0.6, { dx: 24, aura: true });
  b.sfx(35.86, "kiai", 0.8);
  b.slowmo(36.0, 36.7, 0.16);
  b.cue({ kind: "music", t: 36.0, action: "tapeStop" });
  b.cue({ kind: "letterbox", t: 35.95, dur: 0.85 });
  b.cue({
    kind: "cam",
    t: 35.95,
    dur: 0.8,
    zoom: 1.9,
    focus: "trump",
    ramp: 0.1,
  });
  b.hit(36.12, "staal", 100 - dealt, "super", staalHand);
  b.sfx(36.12, "super-hit", 0.75);
  b.sfx(36.12, "slowmo");
  b.sfx(36.14, "oof", 0.6);
  b.clip("trump", 36.12, "launched", 1.4, {
    x: BAR_X,
    y1: 60,
    arc: 170,
    spin: -540,
    ease: "linear",
    face: "ko",
  });
  b.clip("staal", 36.45, "jump", 0.5, { y1: 0, arc: 70, aura: true });
  b.clip("staal", 36.95, "land", 0.35);
  b.sfx(36.72, "whoosh", 0.7);
  b.cue({ kind: "banner", t: 36.75, dur: 2.4, text: "K.O.", style: "ko" });
  b.cue({ kind: "flash", t: 36.75, strength: 0.6 });
  b.sfx(36.8, "bell");
  b.sfx(37.25, "crowd");
  b.cue({ kind: "hype", t: 37.2, dur: 3.5 });

  // Into the beach bar.
  b.clip("trump", 37.52, "wallSplat", 0.5, { y0: 60, y1: 60, face: "ko" });
  b.sfx(37.52, "slam", 0.8);
  b.sfx(37.54, "can-crush", 0.7, 0.8);
  b.burst(37.53, "debris", { x: BAR_X + 10, y: 360 });
  b.burst(37.53, "sparkle", { x: BAR_X + 10, y: 330 });
  b.clip("trump", 38.02, "fallDown", 0.3, { y1: 0, dx: -30 });
  b.sfx(38.3, "slam", 1.1, 0.8);
  b.burst(38.32, "dust", { who: "trump", limb: "hip" });
  b.clip("trump", 38.32, "down", 20, { hold: true, face: "ko" });
  b.prop(38.32, "trump", "stars", true);
  b.sfx(38.5, "dizzy", 0.9, 0.7);

  // ── A well-deserved beer ──────────────────────────────────────────────────
  b.clip("staal", 38.6, "walk", 1.0, { x: 1000, ease: "linear", facing: 1 });
  // A teammate in the crowd lobs him a can; he catches it without looking.
  b.projectile("can", 39.3, 40.1, { x: 560, y: 300 }, staalHand, {
    arc: 140,
    spin: 720,
  });
  b.sfx(39.3, "whoosh", 0.7, 0.6);
  b.clip("staal", 39.8, "catchCan", 0.6, { facing: 1 });
  b.sfx(40.1, "block", 1.5, 0.5);
  b.burst(40.1, "sparkle", staalHand);
  b.prop(40.1, "staal", "can", "closed");
  b.cue({
    kind: "popup",
    t: 40.1,
    dur: 1,
    text: "BIERTJE!",
    at: staalHand,
    color: GOLD,
  });
  b.clip("staal", 40.4, "holdCan", 0.2, { facing: 1 });
  b.clip("staal", 40.6, "openCan", 0.7, { facing: 1 });
  b.sfx(40.86, "can-open");
  b.prop(40.88, "staal", "can", "open");
  b.burst(40.9, "foam", staalHand);
  b.clip("staal", 41.3, "holdCan", 0.1, { facing: 1 });
  b.clip("staal", 41.4, "proost", 1.1, { facing: 1 });
  b.cue({
    kind: "banner",
    t: 41.7,
    dur: 1.3,
    text: "PROOST!",
    style: "proost",
  });
  b.sfx(41.75, "crowd", 1.05);
  b.cue({ kind: "hype", t: 41.7, dur: 1.6 });
  b.burst(41.8, "foam", staalHand);
  b.clip("staal", 42.6, "drink", 1.8, { facing: 1, hold: true });
  b.sfx(42.85, "gulp");
  b.sfx(43.55, "gulp", 0.94);
  b.clip("staal", 44.4, "aah", 0.9, { facing: 1 });
  b.sfx(44.45, "aah");
  b.burst(44.95, "burp", { who: "staal", limb: "mouth" });
  b.clip("staal", 45.3, "holdCan", 1.0, { facing: 1 });
  b.cue({
    kind: "bubble",
    t: 45.0,
    dur: 1.4,
    who: "staal",
    text: "Die heb ik verdiend.",
  });
  b.clip("staal", 46.3, "crush", 0.6, { facing: 1 });
  b.sfx(46.55, "can-crush");
  b.prop(46.55, "staal", "can", "crushed");
  b.clip("staal", 47.0, "toss", 0.6, { facing: 1 });
  b.sfx(47.3, "whoosh", 0.9);
  b.prop(47.3, "staal", "can", "none");
  const tossed = b.projectile("canToss", 47.3, 48.1, staalHand, trumpHead, {
    arc: 150,
    spin: -900,
  });
  b.hit(
    48.1,
    "staal",
    0,
    "block",
    { projectile: tossed },
    { stop: 0, shake: 2 },
  );
  b.sfx(48.1, "can-bonk");
  b.cue({
    kind: "popup",
    t: 48.1,
    dur: 1,
    text: "BONK!",
    at: trumpHead,
    color: HOT,
  });
  b.clip("staal", 48.5, "thumbsUp", 3.0, { facing: 1, hold: true });
  b.cue({
    kind: "banner",
    t: 48.6,
    dur: 3.4,
    text: "STAAL WINT!",
    style: "win",
  });
  b.sfx(48.6, "victory");
  b.sfx(48.7, "crowd", 0.95, 0.8);
  b.cue({ kind: "hype", t: 48.6, dur: 3 });
  b.burst(48.7, "confetti", { x: 700, y: 60 });
  b.cue({
    kind: "cam",
    t: 48.4,
    dur: 5.2,
    zoom: 1.35,
    focus: "staal",
    ramp: 0.8,
  });
  b.cue({ kind: "endCard", t: 51.9 });

  return b.build(53.6);
}
