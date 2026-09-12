import { MAX_EVENTS } from "./limits";
import type { ArenaEvent } from "./types";

/** Appends an event until the per-tick cap is reached. */
export function pushEvent(
  events: ArenaEvent[],
  event: ArenaEvent,
): ArenaEvent[] {
  return events.length >= MAX_EVENTS ? events : [...events, event];
}

/** Returns events of one discriminated-union kind. */
export function eventsOfKind<Kind extends ArenaEvent["kind"]>(
  events: ArenaEvent[],
  kind: Kind,
): Extract<ArenaEvent, { kind: Kind }>[] {
  return events.filter(
    (event): event is Extract<ArenaEvent, { kind: Kind }> =>
      event.kind === kind,
  );
}
