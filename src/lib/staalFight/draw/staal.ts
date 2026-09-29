import type { Vec } from "../math";
import { RIGS, limbPoint, type Joints } from "../rig";
import type { FighterState } from "../timeline";
import type { CanState, Expression, ShadesState } from "../types";
import {
  INK,
  LINE,
  capsulePath,
  hand,
  inked,
  limb,
  roundRect,
  type Tone,
} from "./shapes";

/** Staal's sun-baked skin, lit by the sunset. */
const SKIN: Tone = { light: "#f0b184", base: "#cf8150", dark: "#93522c" };
/** The far-side limbs sit a shade deeper. */
const SKIN_FAR: Tone = { light: "#d49166", base: "#b36a3f", dark: "#7a4222" };
/** Mint board shorts, as on the splash art. */
const SHORTS: Tone = { light: "#d4f2e4", base: "#a3d9c3", dark: "#6aa892" };
const SHORTS_FAR: Tone = { light: "#b7e0cf", base: "#8cc4ad", dark: "#5b917d" };
const BEARD = "#ddd7cd";
const BEARD_SHADE = "#a1998d";

/**
 * Where a point on a limb segment lands, a fraction of the way along.
 *
 * @param a - Start.
 * @param b - End.
 * @param t - Fraction.
 * @returns The point.
 */
function along(a: Vec, b: Vec, t: number): Vec {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** The flexor side of an upper arm: where the biceps bulges. */
function flexSide(upperArm: number): Vec {
  const a = upperArm + Math.PI / 2;
  return { x: Math.sin(a), y: Math.cos(a) };
}

/** One arm: deltoid, biceps, forearm, bracelet, tattoo, hand and (front) the beer. */
function drawArm(
  ctx: CanvasRenderingContext2D,
  j: Joints,
  front: boolean,
  handShape: FighterState["pose"]["handF"],
  can: CanState,
  canAngle: number,
  tipToMouth: boolean,
): void {
  const tone = front ? SKIN : SKIN_FAR;
  const sh = front ? j.shoulderF : j.shoulderB;
  const el = front ? j.elbowF : j.elbowB;
  const wr = front ? j.handF : j.handB;
  const upper = front ? j.upperArmF : j.upperArmB;
  const fore = front ? j.foreArmF : j.foreArmB;

  limb(ctx, sh, el, 12.5, 9.5, tone);
  // Biceps.
  const flex = flexSide(upper);
  const mid = along(sh, el, 0.45);
  ctx.beginPath();
  ctx.ellipse(
    mid.x + flex.x * 5,
    mid.y + flex.y * 5,
    14,
    8.5,
    Math.atan2(el.y - sh.y, el.x - sh.x),
    0,
    Math.PI * 2,
  );
  inked(ctx, tone.base, 2);
  ctx.fillStyle = tone.light;
  ctx.beginPath();
  ctx.ellipse(
    mid.x + flex.x * 6,
    mid.y + flex.y * 6 - 2,
    7,
    3,
    Math.atan2(el.y - sh.y, el.x - sh.x),
    0,
    Math.PI * 2,
  );
  ctx.fill();
  if (front) {
    // Tribal tattoo on the upper arm.
    const p = along(sh, el, 0.3);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(el.y - sh.y, el.x - sh.x));
    ctx.strokeStyle = "rgba(24, 40, 48, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, -4);
    ctx.quadraticCurveTo(0, -9, 6, -3);
    ctx.quadraticCurveTo(2, 1, 8, 5);
    ctx.moveTo(-4, 3);
    ctx.quadraticCurveTo(2, 7, 7, 1);
    ctx.stroke();
    ctx.restore();
  }
  limb(ctx, el, wr, 10, 7.5, tone);
  // Forearm muscle near the elbow.
  const fm = along(el, wr, 0.3);
  ctx.fillStyle = tone.light;
  ctx.beginPath();
  ctx.ellipse(
    fm.x,
    fm.y - 1,
    7,
    3,
    Math.atan2(wr.y - el.y, wr.x - el.x),
    0,
    Math.PI * 2,
  );
  ctx.fill();
  if (front) {
    // Beaded bracelet.
    const b = along(el, wr, 0.86);
    const ang = Math.atan2(wr.y - el.y, wr.x - el.x) + Math.PI / 2;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(
        b.x + Math.cos(ang) * i * 2.4,
        b.y + Math.sin(ang) * i * 2.4,
        2.2,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = i % 2 === 0 ? "#3b2416" : "#5c3a22";
      ctx.fill();
    }
  }
  if (front && can !== "none" && tipToMouth) {
    // Drinking: the can sits on top of the fist, its rim at his mouth.
    hand(ctx, wr, fore, handShape, tone);
    const mouth = limbPoint(j, RIGS.staal, "mouth");
    const len = Math.hypot(mouth.x - wr.x, mouth.y - wr.y) || 1;
    const d = { x: (mouth.x - wr.x) / len, y: (mouth.y - wr.y) / len };
    drawCan(
      ctx,
      { x: wr.x + d.x * 6, y: wr.y + d.y * 6 },
      Math.atan2(d.x, -d.y),
      can,
      CAN_SCALE,
    );
    return;
  }
  if (front && can !== "none") drawCan(ctx, wr, canAngle, can, CAN_SCALE);
  hand(ctx, wr, fore, handShape, tone);
}

/** The can is drawn a size up from life so it reads at a distance. */
const CAN_SCALE = 1.4;

/**
 * The beer can in Staal's hand.
 *
 * @param ctx - Canvas in the figure frame.
 * @param at - Where the hand is.
 * @param angle - Tilt of the can (0 upright).
 * @param state - Closed, open or crushed.
 * @param scale - Size multiplier.
 */
export function drawCan(
  ctx: CanvasRenderingContext2D,
  at: Vec,
  angle: number,
  state: CanState,
  scale = 1,
): void {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  const crushed = state === "crushed";
  const w = 7;
  const h = crushed ? 8 : 13;
  const g = ctx.createLinearGradient(-w, 0, w, 0);
  g.addColorStop(0, "#8a5a10");
  g.addColorStop(0.35, "#f6cf55");
  g.addColorStop(0.6, "#e0a92c");
  g.addColorStop(1, "#7a4c0c");
  ctx.beginPath();
  if (crushed) {
    ctx.moveTo(-w, -h);
    ctx.lineTo(w, -h);
    ctx.lineTo(w * 0.4, 0);
    ctx.lineTo(w, h);
    ctx.lineTo(-w, h);
    ctx.lineTo(-w * 0.5, 1);
    ctx.closePath();
  } else roundRect(ctx, -w, -h, w * 2, h * 2, 2.5);
  inked(ctx, g, 2);
  if (!crushed) {
    ctx.fillStyle = "#fdf6e3";
    ctx.fillRect(-w + 1, -3, w * 2 - 2, 6);
    ctx.fillStyle = "#b3122e";
    ctx.font = "bold 5px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("PILS", 0, 0.5);
  }
  ctx.beginPath();
  ctx.ellipse(0, -h, w, 2.4, 0, 0, Math.PI * 2);
  inked(ctx, "#d9dde2", 1.5);
  if (state === "open") {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(2, -h, 2.2, 1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** One leg: board short over the thigh, bare shin and foot. */
function drawLeg(
  ctx: CanvasRenderingContext2D,
  j: Joints,
  front: boolean,
): void {
  const skin = front ? SKIN : SKIN_FAR;
  const shorts = front ? SHORTS : SHORTS_FAR;
  const hip = front ? j.hipF : j.hipB;
  const knee = front ? j.kneeF : j.kneeB;
  const ankle = front ? j.ankleF : j.ankleB;
  const toe = front ? j.toeF : j.toeB;

  limb(ctx, hip, knee, 14, 11, skin);
  limb(ctx, knee, ankle, 10.5, 7, skin);
  // Calf.
  const calf = along(knee, ankle, 0.3);
  const back = front ? j.shinF - Math.PI / 2 : j.shinB - Math.PI / 2;
  ctx.beginPath();
  ctx.ellipse(
    calf.x + Math.sin(back) * 4,
    calf.y + Math.cos(back) * 4,
    11,
    6.5,
    Math.atan2(ankle.y - knee.y, ankle.x - knee.x),
    0,
    Math.PI * 2,
  );
  inked(ctx, skin.base, 2);
  // Bare foot.
  capsulePath(ctx, ankle, toe, 7, 5.5);
  inked(ctx, skin.base);
  // The short leg, loose over the upper thigh, with a hem.
  const hem = along(hip, knee, 0.66);
  limb(ctx, hip, hem, 17, 16, shorts);
  ctx.strokeStyle = "rgba(27, 15, 20, 0.35)";
  ctx.lineWidth = 1.5;
  const ang = Math.atan2(knee.y - hip.y, knee.x - hip.x);
  ctx.beginPath();
  ctx.moveTo(
    hem.x - Math.cos(ang + Math.PI / 2) * 13,
    hem.y - Math.sin(ang + Math.PI / 2) * 13,
  );
  ctx.lineTo(
    hem.x + Math.cos(ang + Math.PI / 2) * 13,
    hem.y + Math.sin(ang + Math.PI / 2) * 13,
  );
  ctx.stroke();
}

/** The torso in its own frame: V-taper, pecs, six-pack, chest hair. */
function drawTorso(ctx: CanvasRenderingContext2D, j: Joints): void {
  ctx.save();
  ctx.rotate(j.torsoAngle);
  const g = ctx.createLinearGradient(-24, 0, 30, 0);
  g.addColorStop(0, SKIN.dark);
  g.addColorStop(0.45, SKIN.base);
  g.addColorStop(0.8, SKIN.light);
  g.addColorStop(1, SKIN.base);
  ctx.beginPath();
  ctx.moveTo(-17, -4);
  ctx.quadraticCurveTo(-21, -30, -23, -56);
  ctx.quadraticCurveTo(-23, -72, -9, -80);
  ctx.lineTo(9, -80);
  ctx.quadraticCurveTo(24, -76, 27, -62);
  ctx.quadraticCurveTo(31, -50, 25, -44);
  ctx.quadraticCurveTo(21, -36, 21, -24);
  ctx.quadraticCurveTo(21, -10, 17, -2);
  ctx.closePath();
  inked(ctx, g);

  ctx.strokeStyle = "rgba(90, 40, 20, 0.55)";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  // Pec line and sternum.
  ctx.moveTo(4, -48);
  ctx.quadraticCurveTo(16, -40, 27, -47);
  ctx.moveTo(6, -72);
  ctx.lineTo(7, -48);
  // Abs.
  ctx.moveTo(12, -44);
  ctx.lineTo(12, -8);
  for (const y of [-36, -26, -16]) {
    ctx.moveTo(4, y);
    ctx.quadraticCurveTo(12, y + 3, 20, y);
  }
  ctx.stroke();
  // Pec highlight.
  ctx.fillStyle = "rgba(255, 220, 190, 0.35)";
  ctx.beginPath();
  ctx.ellipse(17, -58, 8, 4, -0.2, 0, Math.PI * 2);
  ctx.fill();
  // Chest hair.
  ctx.strokeStyle = "rgba(70, 55, 45, 0.55)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 14; i++) {
    const x = 2 + ((i * 37) % 20);
    const y = -66 + ((i * 53) % 18);
    ctx.moveTo(x, y);
    ctx.lineTo(x + 2, y + 3);
  }
  ctx.stroke();
  ctx.restore();

  // Waistband of the shorts.
  roundRect(ctx, -21, -12, 43, 16, 5);
  inked(ctx, SHORTS.base);
  ctx.strokeStyle = "#f5f1e6";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(12, -8);
  ctx.quadraticCurveTo(15, 2, 11, 8);
  ctx.moveTo(15, -8);
  ctx.quadraticCurveTo(19, 3, 17, 9);
  ctx.stroke();
}

/** Mouth inside the beard for each mood. */
function drawMouth(ctx: CanvasRenderingContext2D, face: Expression): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  switch (face) {
    case "shout":
    case "aah":
      ctx.beginPath();
      ctx.ellipse(16, 14, 5, face === "aah" ? 6 : 5, 0, 0, Math.PI * 2);
      inked(ctx, "#3a1010", 2);
      ctx.fillStyle = "#c2454a";
      ctx.beginPath();
      ctx.ellipse(16, 17, 3, 2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "grit":
    case "hurt":
      roundRect(ctx, 10, 10, 11, 5, 1.5);
      inked(ctx, "#f6f1e4", 1.6);
      ctx.beginPath();
      ctx.moveTo(10, 12.5);
      ctx.lineTo(21, 12.5);
      ctx.stroke();
      break;
    case "drink":
      break;
    default:
      ctx.beginPath();
      ctx.moveTo(10, 13);
      ctx.quadraticCurveTo(16, 15, 21, 10);
      ctx.stroke();
  }
}

/** The sunglasses: red lenses, dark frame; knocked askew or lowered on the nose. */
function drawShades(ctx: CanvasRenderingContext2D, shades: ShadesState): void {
  ctx.save();
  if (shades === "askew") {
    ctx.translate(10, -4);
    ctx.rotate(0.28);
    ctx.translate(-10, -2);
  } else if (shades === "down") ctx.translate(2, 6);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-8, -3);
  ctx.lineTo(1, -5);
  ctx.moveTo(6, -5);
  ctx.lineTo(9, -5);
  ctx.stroke();
  const lens = (x: number, w: number): void => {
    const g = ctx.createLinearGradient(x, -10, x + w, 0);
    g.addColorStop(0, "#ff5a6e");
    g.addColorStop(0.5, "#c01631");
    g.addColorStop(1, "#5c0716");
    roundRect(ctx, x, -10, w, 10, 3);
    inked(ctx, g, 2.4);
  };
  lens(0, 7);
  lens(8.5, 13);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(12, -8);
  ctx.lineTo(16, -3);
  ctx.stroke();
  ctx.restore();
}

/** Staal's head in its own frame: bald dome, grey beard, red shades. */
export function drawStaalHead(
  ctx: CanvasRenderingContext2D,
  face: Expression,
  shades: ShadesState,
): void {
  // Ear (behind the skull edge).
  ctx.beginPath();
  ctx.ellipse(-8, 3, 5, 7.5, 0.1, 0, Math.PI * 2);
  inked(ctx, SKIN.dark, 2);
  // Skull.
  const g = ctx.createRadialGradient(4, -12, 3, 0, 0, 26);
  g.addColorStop(0, SKIN.light);
  g.addColorStop(0.6, SKIN.base);
  g.addColorStop(1, SKIN.dark);
  ctx.beginPath();
  ctx.ellipse(1, -1, 19.5, 22, 0, 0, Math.PI * 2);
  inked(ctx, g);
  // Nose.
  ctx.beginPath();
  ctx.moveTo(17, -6);
  ctx.quadraticCurveTo(25, 2, 18, 5);
  inked(ctx, SKIN.base, 2);
  // Beard.
  ctx.beginPath();
  ctx.moveTo(-11, 1);
  ctx.quadraticCurveTo(-12, 16, -2, 25);
  ctx.quadraticCurveTo(4, 31, 12, 29);
  ctx.quadraticCurveTo(21, 26, 21, 15);
  ctx.quadraticCurveTo(22, 8, 19, 6);
  ctx.quadraticCurveTo(12, 3, 6, 7);
  ctx.quadraticCurveTo(-2, 8, -6, 2);
  ctx.closePath();
  inked(ctx, BEARD, 2.4);
  ctx.strokeStyle = BEARD_SHADE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const x = -8 + ((i * 29) % 26);
    const y = 8 + ((i * 17) % 18);
    ctx.moveTo(x, y);
    ctx.lineTo(x + 1, y + 3);
  }
  ctx.stroke();
  // Moustache.
  ctx.beginPath();
  ctx.moveTo(8, 8);
  ctx.quadraticCurveTo(16, 3, 23, 8);
  ctx.quadraticCurveTo(17, 11, 8, 10);
  ctx.closePath();
  inked(ctx, "#eeeae2", 1.8);
  drawMouth(ctx, face);
  // Brows: fierce by default, raised when the shades come down.
  ctx.strokeStyle = "#8f877c";
  ctx.lineWidth = 3.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (shades === "down") {
    ctx.moveTo(6, -15);
    ctx.lineTo(19, -13);
  } else if (face === "hurt") {
    ctx.moveTo(6, -14);
    ctx.lineTo(19, -10);
  } else {
    ctx.moveTo(5, -14);
    ctx.lineTo(19, -9);
  }
  ctx.stroke();
  ctx.lineCap = "butt";
  if (shades === "down") {
    // Eyes above the lowered shades: the stare.
    for (const x of [7, 17]) {
      ctx.beginPath();
      ctx.ellipse(x, -7, x === 7 ? 2.4 : 3.4, 2.4, 0, 0, Math.PI * 2);
      inked(ctx, "#fbf7ee", 1.4);
      ctx.fillStyle = "#2b3a4a";
      ctx.beginPath();
      ctx.arc(x + 1, -7, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  drawShades(ctx, shades);
  // Shine on the bald head and a couple of forehead lines.
  ctx.fillStyle = "rgba(255, 240, 220, 0.45)";
  ctx.beginPath();
  ctx.ellipse(-1, -15, 9, 4.5, -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(110, 50, 25, 0.45)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(6, -18);
  ctx.quadraticCurveTo(12, -19.5, 17, -17);
  ctx.moveTo(7, -21);
  ctx.quadraticCurveTo(12, -22.5, 16, -20.5);
  ctx.stroke();
}

/**
 * Draws Staal in his own frame (hip at the origin, facing right, already rotated).
 *
 * @param ctx - Canvas.
 * @param s - Staal's state.
 */
export function drawStaal(
  ctx: CanvasRenderingContext2D,
  s: FighterState,
): void {
  const j = s.joints;
  const canAngle = -s.rot - s.props.canTilt * 1.95;
  drawArm(ctx, j, false, s.pose.handB, "none", 0, false);
  drawLeg(ctx, j, false);
  drawTorso(ctx, j);
  drawLeg(ctx, j, true);
  // Neck: thick.
  const neckTop = {
    x: j.head.x - Math.sin(j.headAngle) * 12,
    y: j.head.y + Math.cos(j.headAngle) * 12,
  };
  limb(ctx, j.neck, neckTop, 12, 11, SKIN);
  ctx.save();
  ctx.translate(j.head.x, j.head.y);
  ctx.rotate(j.headAngle);
  drawStaalHead(ctx, s.face, s.props.shades);
  ctx.restore();
  drawArm(
    ctx,
    j,
    true,
    s.pose.handF,
    s.props.can,
    canAngle,
    s.props.canTilt > 0.5,
  );
  ctx.lineWidth = LINE;
}
