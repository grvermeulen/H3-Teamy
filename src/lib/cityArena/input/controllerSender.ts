import * as Sentry from "@sentry/nextjs";
import { EMPTY_INPUT, type WorldInput } from "../sim/types";
import type { TransportChannel } from "../net/transport";
import { encodeInput } from "../net/wire";

/** Input-only publisher with short presses latched between 15 Hz sends and 2 Hz idle heartbeats. */
export function createControllerSender(
  channel: TransportChannel,
  nextSequence?: () => number,
): {
  update(input: WorldInput, now: number): void;
  release(): void;
  stop(): void;
} {
  let seq = 0;
  let lastAt = -Infinity;
  let lastWire = "";
  let edges = { fire: false, enter: false, weaponNext: false };
  let reported = false;
  let stopped = false;
  const send = (input: WorldInput): void => {
    if (stopped) return;
    seq = nextSequence ? nextSequence() : seq + 1;
    lastWire = JSON.stringify(encodeInput(0, input));
    void channel
      .publish("input", encodeInput(seq, input))
      .catch((error: unknown) => {
        if (reported || stopped) return;
        reported = true;
        Sentry.captureException(error, {
          tags: { area: "arena", kind: "controller-input" },
        });
      });
  };
  return {
    update(input, now) {
      edges = {
        fire: edges.fire || input.fire,
        enter: edges.enter || input.enter,
        weaponNext: edges.weaponNext || input.weaponNext,
      };
      const outgoing = { ...input, ...edges };
      const changed = JSON.stringify(encodeInput(0, outgoing)) !== lastWire;
      const active =
        Math.hypot(...input.move) > 0.05 ||
        input.fire ||
        input.enter ||
        input.weaponNext;
      if (now - lastAt < (active || changed ? 1000 / 15 : 500)) return;
      send(outgoing);
      lastAt = now;
      edges = { fire: false, enter: false, weaponNext: false };
    },
    release() {
      edges = { fire: false, enter: false, weaponNext: false };
      send(EMPTY_INPUT);
    },
    stop() {
      stopped = true;
    },
  };
}
