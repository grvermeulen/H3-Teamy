"use client";

import { useEffect, useRef, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import type { LobbyRoom } from "@/lib/cityArena/net/lobbyPresence";
import type { RoomsState } from "./RoomList";

/**
 * How often the launcher refreshes the active potjes (spec §2).
 *
 * The card polls a cached server route rather than holding an Ably connection, because it sits on
 * the home page and Ably's free tier caps *concurrent connections* — an idle visitor must not
 * spend one.
 */
export const ROOMS_POLL_MS = 10_000;

/** Where the list comes from. */
const ROOMS_URL = "/api/arena/rooms";

/** Parses the route's response, tolerating anything unexpected. */
function readRooms(body: unknown): LobbyRoom[] | null {
  if (typeof body !== "object" || body === null) return null;
  const rooms = (body as { rooms?: unknown }).rooms;
  return Array.isArray(rooms) ? (rooms as LobbyRoom[]) : null;
}

/**
 * Polls the active potjes while the launcher is on screen.
 *
 * Polling stops while the tab is hidden and resumes on return, so a backgrounded home page costs
 * nothing. The first load after returning is immediate rather than a poll interval later.
 *
 * @param enabled - False for signed-out visitors, who see the login prompt instead.
 * @returns The rooms state to hand {@link RoomList}.
 */
export function useActiveRooms(enabled: boolean): RoomsState {
  const [state, setState] = useState<RoomsState>({ status: "loading" });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!enabled) {
      setState({ status: "ready", rooms: [] });
      return () => {
        alive.current = false;
      };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async (): Promise<void> => {
      try {
        const response = await fetch(ROOMS_URL, { cache: "no-store" });
        if (!response.ok) throw new Error(`rooms responded ${response.status}`);
        const rooms = readRooms(await response.json());
        if (!alive.current) return;
        setState(rooms ? { status: "ready", rooms } : { status: "offline" });
      } catch (error: unknown) {
        Sentry.captureException(error, {
          tags: { area: "arena", kind: "rooms-poll" },
        });
        if (alive.current) setState({ status: "offline" });
      }
    };

    const schedule = (): void => {
      // A fetch that was in flight when the tab hid or the card unmounted resolves later and
      // would otherwise start a second chain — one that outlives the card, or doubles the
      // request rate on every hide/show. Always clear, and only reschedule while wanted.
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (!alive.current || document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        void load().then(schedule);
      }, ROOMS_POLL_MS);
    };

    const onVisibility = (): void => {
      if (document.visibilityState !== "visible") {
        if (timer) clearTimeout(timer);
        timer = undefined;
        return;
      }
      void load().then(schedule);
    };

    void load().then(schedule);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive.current = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);

  return state;
}
