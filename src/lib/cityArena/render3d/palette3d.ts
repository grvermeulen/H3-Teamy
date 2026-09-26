/**
 * Colours of the 3D city's evening, as plain hex numbers so modules without three.js can share
 * them. The 2D map is painted at night (`render/palette.ts`); the 3D view keeps that mood but lifts
 * it to dusk, so streets stay readable at eye level.
 */

/** Zenith of the sky dome. */
export const SKY_TOP = 0x0b1630;
/** The sky just above the horizon. */
export const SKY_HORIZON = 0x3a4a6b;
/** The warm band of the last light along the horizon. */
export const HORIZON_GLOW = 0xd08a52;
/** Distance fog; close to the horizon so the city fades into the sky. */
export const FOG_COLOUR = 0x26324c;
/** The moon's directional light. */
export const MOON_LIGHT = 0xb9c8ff;
/** The hemisphere light's sky half. */
export const AMBIENT_SKY = 0x5a6c9a;
/** The hemisphere light's ground half. */
export const AMBIENT_GROUND = 0x2a2420;
/** Street lamp heads and their glow. */
export const LAMP_GLOW = 0xffc46b;
/** A window lit by a warm bulb. */
export const WINDOW_WARM = 0xffcf7a;
/** A window lit by a screen or a cold tube. */
export const WINDOW_COLD = 0xa9d2ff;
/** A dark window. */
export const WINDOW_DARK = 0x1a1f2b;
