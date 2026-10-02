import {
  createFakeContext,
  type FakeContext,
} from "../../render/testing/fakeContext";
import { WINDOW_COLD, WINDOW_WARM } from "../palette3d";

/**
 * A hex colour number as the CSS string the façade painter assigns to `fillStyle`.
 *
 * @param colour - A colour such as `WINDOW_WARM`.
 * @returns `#rrggbb`.
 */
export function cssColour(colour: number): string {
  return `#${colour.toString(16).padStart(6, "0")}`;
}

/**
 * A fake 2D context whose `fillRect` also logs the fill colour, as `fillRect(#rrggbb,x,y,w,h)`,
 * so tests can tell which windows were painted lit.
 *
 * @returns The recording context.
 */
export function createColourRecordingContext(): FakeContext {
  const context = createFakeContext();
  context.fillRect = (x: number, y: number, width: number, height: number) => {
    context.calls.push(
      `fillRect(${String(context.fillStyle)},${x},${y},${width},${height})`,
    );
  };
  return context;
}

/**
 * The `fillRect` calls that painted a lit window, warm or cold, in paint order.
 *
 * @param context - A context from {@link createColourRecordingContext}.
 * @returns The matching calls.
 */
export function litWindowFills(context: FakeContext): string[] {
  const lit = [cssColour(WINDOW_WARM), cssColour(WINDOW_COLD)];
  return context.calls.filter((call) =>
    lit.some((fill) => call.startsWith(`fillRect(${fill},`)),
  );
}
