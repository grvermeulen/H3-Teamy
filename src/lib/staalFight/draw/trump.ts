import type { Vec } from "../math";
import type { Joints } from "../rig";
import type { FighterState } from "../timeline";
import type { Expression } from "../types";
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

const SKIN: Tone = { light: "#ffc486", base: "#f29a4e", dark: "#b8642c" };
const SUIT: Tone = { light: "#3c4d7e", base: "#25335c", dark: "#141c38" };
const SUIT_FAR: Tone = { light: "#2f3e68", base: "#1d294c", dark: "#10162c" };
const HAIR: Tone = { light: "#fff0b5", base: "#f4d279", dark: "#c99a3c" };
const TIE = "#d3122d";
const TIE_DARK = "#8f0a1c";
const SHIRT = "#f5f2ea";

function along(a: Vec, b: Vec, t: number): Vec {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** A sleeve, a white cuff and a small hand. */
function drawArm(
  ctx: CanvasRenderingContext2D,
  j: Joints,
  front: boolean,
  shape: FighterState["pose"]["handF"],
): void {
  const tone = front ? SUIT : SUIT_FAR;
  const sh = front ? j.shoulderF : j.shoulderB;
  const el = front ? j.elbowF : j.elbowB;
  const wr = front ? j.handF : j.handB;
  const fore = front ? j.foreArmF : j.foreArmB;
  limb(ctx, sh, el, 12, 10, tone);
  limb(ctx, el, along(el, wr, 0.9), 10, 9, tone);
  const cuff = along(el, wr, 0.9);
  capsulePath(ctx, cuff, wr, 6, 5.5);
  inked(ctx, SHIRT, 2);
  hand(ctx, wr, fore, shape, SKIN, 0.78);
}

/** Trousers and a polished shoe. */
function drawLeg(
  ctx: CanvasRenderingContext2D,
  j: Joints,
  front: boolean,
): void {
  const tone = front ? SUIT : SUIT_FAR;
  const hip = front ? j.hipF : j.hipB;
  const knee = front ? j.kneeF : j.kneeB;
  const ankle = front ? j.ankleF : j.ankleB;
  const toe = front ? j.toeF : j.toeB;
  limb(ctx, hip, knee, 14, 12, tone);
  limb(ctx, knee, ankle, 12, 10, tone);
  capsulePath(ctx, ankle, toe, 8, 6.5);
  inked(ctx, "#1f1a18");
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  const shine = along(ankle, toe, 0.6);
  ctx.beginPath();
  ctx.ellipse(shine.x, shine.y - 3, 4, 1.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * The long red tie. Hanging, it follows the belly; cracked out, it is a whip.
 *
 * @param ctx - Canvas in the torso frame.
 * @param whip - 0 hanging, 1 fully out.
 * @param time - Seconds, for the ripple.
 */
function drawTie(
  ctx: CanvasRenderingContext2D,
  whip: number,
  time: number,
  torsoAngle: number,
): void {
  const knot = { x: 15, y: -80 };
  ctx.beginPath();
  ctx.moveTo(knot.x - 4, knot.y - 3);
  ctx.lineTo(knot.x + 5, knot.y - 3);
  ctx.lineTo(knot.x + 4, knot.y + 5);
  ctx.lineTo(knot.x - 2, knot.y + 5);
  ctx.closePath();
  inked(ctx, TIE_DARK, 2);
  if (whip <= 0.02) {
    ctx.beginPath();
    ctx.moveTo(knot.x - 2, knot.y + 5);
    ctx.lineTo(knot.x + 4, knot.y + 5);
    ctx.quadraticCurveTo(38, -42, 38, -6);
    ctx.lineTo(33, 4);
    ctx.lineTo(29, -6);
    ctx.quadraticCurveTo(26, -44, knot.x - 2, knot.y + 5);
    ctx.closePath();
    inked(ctx, TIE, 2);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(22, -60);
    ctx.lineTo(30, -40);
    ctx.stroke();
    return;
  }
  // The whip: a long ribbon cracking forward (level, a touch upwards, whatever the lean),
  // rippling as it goes.
  ctx.translate(knot.x, knot.y);
  ctx.rotate(-torsoAngle - 0.22);
  ctx.translate(-knot.x, -knot.y);
  const len = 40 + 135 * whip;
  const pts: Vec[] = [];
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    pts.push({
      x: knot.x + 4 + u * len,
      y: knot.y + 8 + Math.sin(u * 9 - time * 30) * 7 * u * (1 - whip * 0.5),
    });
  }
  ctx.lineCap = "round";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 11;
  ctx.beginPath();
  pts.forEach((p, i) =>
    i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
  );
  ctx.stroke();
  ctx.strokeStyle = TIE;
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.lineCap = "butt";
  const tip = pts[pts.length - 1];
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y - 6);
  ctx.lineTo(tip.x + 12, tip.y);
  ctx.lineTo(tip.x, tip.y + 6);
  ctx.closePath();
  inked(ctx, TIE, 2);
}

/** Jacket with a generous belly, shirt, lapels, buttons and the tie. */
function drawTorso(
  ctx: CanvasRenderingContext2D,
  j: Joints,
  whip: number,
  time: number,
): void {
  ctx.save();
  ctx.rotate(j.torsoAngle);
  const g = ctx.createLinearGradient(-26, 0, 40, 0);
  g.addColorStop(0, SUIT.dark);
  g.addColorStop(0.5, SUIT.base);
  g.addColorStop(0.85, SUIT.light);
  g.addColorStop(1, SUIT.base);
  ctx.beginPath();
  ctx.moveTo(-21, 14);
  ctx.quadraticCurveTo(-24, -30, -25, -62);
  ctx.quadraticCurveTo(-25, -82, -10, -86);
  ctx.lineTo(10, -86);
  ctx.quadraticCurveTo(26, -84, 28, -66);
  ctx.quadraticCurveTo(44, -44, 40, -20);
  ctx.quadraticCurveTo(37, 2, 27, 14);
  ctx.closePath();
  inked(ctx, g);
  // Shirt V and lapels.
  ctx.beginPath();
  ctx.moveTo(4, -86);
  ctx.lineTo(24, -86);
  ctx.lineTo(24, -52);
  ctx.closePath();
  inked(ctx, SHIRT, 2);
  ctx.beginPath();
  ctx.moveTo(4, -86);
  ctx.lineTo(24, -50);
  ctx.lineTo(14, -60);
  ctx.closePath();
  inked(ctx, SUIT.dark, 2);
  ctx.fillStyle = "#e7e3d8";
  ctx.beginPath();
  ctx.arc(34, -30, 2.2, 0, Math.PI * 2);
  ctx.arc(34, -14, 2.2, 0, Math.PI * 2);
  ctx.fill();
  drawTie(ctx, whip, time, j.torsoAngle);
  ctx.restore();
}

/** Mouth per mood: the famous pout by default. */
function drawMouth(ctx: CanvasRenderingContext2D, face: Expression): void {
  switch (face) {
    case "shout":
    case "angry":
      ctx.beginPath();
      ctx.ellipse(16, 13, 6, face === "shout" ? 6 : 4, 0, 0, Math.PI * 2);
      inked(ctx, "#4a1414", 2);
      ctx.fillStyle = "#fbf7ee";
      ctx.fillRect(11, 8.5, 10, 2.5);
      break;
    case "hurt":
    case "ko":
      ctx.beginPath();
      ctx.ellipse(16, 14, 5, 6, 0, 0, Math.PI * 2);
      inked(ctx, "#4a1414", 2);
      if (face === "ko") {
        ctx.fillStyle = "#e0616b";
        ctx.beginPath();
        ctx.ellipse(18, 20, 3.5, 5, 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "dizzy":
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(10, 14);
      for (let i = 1; i <= 4; i++)
        ctx.lineTo(10 + i * 3, 14 + (i % 2 ? -2 : 2));
      ctx.stroke();
      break;
    default:
      // The pout.
      ctx.beginPath();
      ctx.ellipse(17, 13, 4.5, 3.8, 0, 0, Math.PI * 2);
      inked(ctx, "#d86a5a", 2);
      ctx.fillStyle = "#5a1e1e";
      ctx.beginPath();
      ctx.ellipse(17, 13, 1.8, 1.3, 0, 0, Math.PI * 2);
      ctx.fill();
  }
}

/** Eyes per mood: a squint by default. */
function drawEyes(ctx: CanvasRenderingContext2D, face: Expression): void {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  if (face === "ko") {
    for (const x of [10, 18]) {
      ctx.beginPath();
      ctx.moveTo(x - 2.5, -6.5);
      ctx.lineTo(x + 2.5, -1.5);
      ctx.moveTo(x + 2.5, -6.5);
      ctx.lineTo(x - 2.5, -1.5);
      ctx.stroke();
    }
  } else if (face === "dizzy") {
    for (const x of [10, 18]) {
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 4; a += 0.4) {
        const r = a * 0.35;
        const px = x + Math.cos(a) * r;
        const py = -4 + Math.sin(a) * r;
        if (a === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  } else if (face === "hurt") {
    ctx.beginPath();
    ctx.moveTo(8, -6);
    ctx.lineTo(12, -3);
    ctx.lineTo(8, -1);
    ctx.moveTo(20, -6);
    ctx.lineTo(16, -3);
    ctx.lineTo(20, -1);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(8, -4);
    ctx.lineTo(12, -4.5);
    ctx.moveTo(16, -4.5);
    ctx.lineTo(21, -4);
    ctx.stroke();
    ctx.fillStyle = "#2a4d7a";
    ctx.beginPath();
    ctx.arc(19, -3.6, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  // Brows: pale, pushed down when angry.
  ctx.strokeStyle = "#e8c77a";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  const angry = face === "angry" || face === "shout";
  ctx.moveTo(7, angry ? -12 : -10);
  ctx.lineTo(13, angry ? -8 : -10.5);
  ctx.moveTo(15, angry ? -8 : -10.5);
  ctx.lineTo(22, angry ? -11 : -10);
  ctx.stroke();
  ctx.lineCap = "butt";
}

/**
 * The hair: a swooping blond wave. `lift` flips it up from the back like a lid.
 *
 * @param ctx - Canvas in the head frame.
 * @param lift - 0 in place, 1 blown up.
 */
function drawHair(ctx: CanvasRenderingContext2D, lift: number): void {
  ctx.save();
  ctx.translate(-18, -4);
  ctx.rotate(-lift * 0.75);
  ctx.translate(18, 4 - lift * 7);
  const g = ctx.createLinearGradient(0, -36, 0, 0);
  g.addColorStop(0, HAIR.light);
  g.addColorStop(0.5, HAIR.base);
  g.addColorStop(1, HAIR.dark);
  ctx.beginPath();
  ctx.moveTo(-21, 6);
  ctx.quadraticCurveTo(-27, -12, -18, -28);
  ctx.quadraticCurveTo(-4, -38, 12, -34);
  ctx.quadraticCurveTo(28, -30, 31, -18);
  ctx.quadraticCurveTo(32, -9, 25, -11);
  ctx.quadraticCurveTo(22, -18, 13, -17);
  ctx.quadraticCurveTo(2, -17, -6, -20);
  ctx.quadraticCurveTo(-12, -10, -14, 4);
  ctx.closePath();
  inked(ctx, g, 2.4);
  ctx.strokeStyle = HAIR.dark;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-16, -22);
  ctx.quadraticCurveTo(4, -34, 26, -22);
  ctx.moveTo(-18, -12);
  ctx.quadraticCurveTo(2, -28, 22, -16);
  ctx.moveTo(-8, -28);
  ctx.quadraticCurveTo(10, -36, 28, -24);
  ctx.stroke();
  ctx.restore();
}

/**
 * Trump's head in its own frame.
 *
 * @param ctx - Canvas.
 * @param face - Expression.
 * @param hairLift - How far the hair is blown up.
 */
export function drawTrumpHead(
  ctx: CanvasRenderingContext2D,
  face: Expression,
  hairLift: number,
): void {
  ctx.beginPath();
  ctx.ellipse(-9, 4, 5, 7.5, 0.1, 0, Math.PI * 2);
  inked(ctx, SKIN.dark, 2);
  const g = ctx.createRadialGradient(6, -6, 3, 0, 2, 28);
  g.addColorStop(0, SKIN.light);
  g.addColorStop(0.6, SKIN.base);
  g.addColorStop(1, SKIN.dark);
  // Face with jowls and a double chin.
  ctx.beginPath();
  ctx.moveTo(-14, -14);
  ctx.quadraticCurveTo(0, -26, 16, -18);
  ctx.quadraticCurveTo(24, -10, 23, 2);
  ctx.quadraticCurveTo(25, 14, 20, 22);
  ctx.quadraticCurveTo(10, 30, -2, 26);
  ctx.quadraticCurveTo(-16, 20, -18, 4);
  ctx.quadraticCurveTo(-19, -6, -14, -14);
  ctx.closePath();
  inked(ctx, g);
  ctx.strokeStyle = "rgba(120, 50, 20, 0.5)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(4, 25);
  ctx.quadraticCurveTo(12, 29, 18, 24);
  ctx.moveTo(22, 6);
  ctx.quadraticCurveTo(19, 12, 22, 18);
  ctx.stroke();
  // The pale goggle band round the eyes.
  ctx.fillStyle = "#fbd9a6";
  ctx.beginPath();
  ctx.ellipse(14, -4, 11, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Nose.
  ctx.beginPath();
  ctx.moveTo(20, -3);
  ctx.quadraticCurveTo(29, 4, 21, 7);
  inked(ctx, SKIN.base, 2);
  drawEyes(ctx, face);
  drawMouth(ctx, face);
  drawHair(ctx, hairLift);
}

/**
 * Draws Trump in his own frame (hip at the origin, facing right, already rotated).
 *
 * @param ctx - Canvas.
 * @param s - Trump's state.
 * @param time - Seconds, for the tie ripple.
 */
export function drawTrump(
  ctx: CanvasRenderingContext2D,
  s: FighterState,
  time: number,
): void {
  const j = s.joints;
  drawArm(ctx, j, false, s.pose.handB);
  drawLeg(ctx, j, false);
  drawLeg(ctx, j, true);
  drawTorso(ctx, j, s.props.tieWhip, time);
  // Shirt collar and neck.
  const neckTop = {
    x: j.head.x - Math.sin(j.headAngle) * 14,
    y: j.head.y + Math.cos(j.headAngle) * 14,
  };
  limb(ctx, j.neck, neckTop, 12, 12, SKIN);
  roundRect(ctx, j.neck.x - 11, j.neck.y - 6, 24, 8, 3);
  inked(ctx, SHIRT, 2);
  ctx.save();
  ctx.translate(j.head.x, j.head.y);
  ctx.rotate(j.headAngle);
  drawTrumpHead(ctx, s.face, s.props.hairLift);
  ctx.restore();
  drawArm(ctx, j, true, s.pose.handF);
  ctx.lineWidth = LINE;
}
