"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createArenaObserver,
  type ArenaObserver,
} from "@/lib/cityArena/net/observerLoop";
import { arenaChannels } from "@/lib/cityArena/net/roomProtocol";
import {
  createInputState,
  type ButtonName,
} from "@/lib/cityArena/input/inputState";
import { createControllerSender } from "@/lib/cityArena/input/controllerSender";
import { createHaptics } from "@/lib/cityArena/input/haptics";
import { aimFromVector } from "@/lib/cityArena/input/touchStick";
import { readArenaGamepad } from "@/lib/cityArena/input/gamepad";
import type { ArenaPlayerState } from "@/lib/cityArena/sim/types";
import type { ArenaRoom } from "./useArenaRoom";
import type { MatchPeek, MatchSeam } from "./matchSeam";

/** Controller-only data and actions: importing this hook never loads map assets. */
export function useArenaController(
  room: ArenaRoom,
  vibrate: boolean,
): MatchSeam & {
  player: ArenaPlayerState | null;
  receiving: boolean;
  setInputVector(vector: [number, number] | null): void;
  setAimVector(vector: [number, number] | null): void;
  setButton(name: ButtonName, pressed: boolean): void;
} {
  const input = useRef(createInputState());
  const observerRef = useRef<ArenaObserver | null>(null);
  const [player, setPlayer] = useState<ArenaPlayerState | null>(null);
  const [receiving, setReceiving] = useState(false);
  const vibrateRef = useRef(vibrate);
  const sequence = useRef(0);
  useEffect(() => {
    vibrateRef.current = vibrate;
  }, [vibrate]);
  const { ticket, transport, connection, status } = room;
  const host = ticket?.hostClientId;
  const epoch = ticket?.epoch;
  const memberId = ticket?.memberId;
  const roomId = ticket?.roomId;
  const zone = room.zone;
  useEffect(() => {
    const live = transport();
    setReceiving(false);
    if (
      !live ||
      !host ||
      !roomId ||
      !epoch ||
      !memberId ||
      connection !== "connected" ||
      status !== "ready"
    )
      return undefined;
    const channels = arenaChannels(roomId, epoch);
    const controls = input.current;
    const sender = createControllerSender(
      live.channel(channels.inputs),
      () => ++sequence.current,
    );
    const haptics = createHaptics(
      { vibrate: (pattern) => navigator.vibrate?.(pattern) ?? false },
      () => vibrateRef.current,
    );
    let previousHealth: number | null = null;
    let lastSnapshotAt = -Infinity;
    const observer = createArenaObserver({
      transport: live,
      stateChannel: channels.state,
      hostClientId: host,
      zone,
      onSnapshot(state, view) {
        lastSnapshotAt = performance.now();
        const id = view.seats.get(memberId);
        const me =
          state.players.find((candidate) => candidate.id === id) ?? null;
        setPlayer(me);
        setReceiving(me !== null);
        if (me && previousHealth !== null && me.health < previousHealth)
          haptics.fire(me.health === 0 ? "death" : "hit");
        previousHealth = me?.health ?? null;
      },
    });
    observerRef.current = observer;
    const release = (): void => {
      controls.clearAll();
      sender.release();
    };
    const visibility = (): void => {
      if (document.hidden) release();
    };
    window.addEventListener("blur", release);
    window.addEventListener("gamepaddisconnected", release);
    document.addEventListener("visibilitychange", visibility);
    const interval = setInterval(() => {
      if (document.hidden) return;
      const stale = performance.now() - lastSnapshotAt > 2000;
      if (stale) {
        setReceiving(false);
        controls.clearAll();
      }
      sender.update(
        stale ? controls.snapshot() : readArenaGamepad(controls.snapshot()),
        performance.now(),
      );
    }, 1000 / 30);
    return () => {
      controls.clearAll();
      sender.stop();
      clearInterval(interval);
      observer.stop();
      observerRef.current = null;
      window.removeEventListener("blur", release);
      window.removeEventListener("gamepaddisconnected", release);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [transport, host, epoch, memberId, roomId, connection, status, zone]);
  const peek = useCallback((): MatchPeek | null => {
    const observer = observerRef.current;
    const view = observer?.snapshot();
    if (!observer || !view) return null;
    return {
      tick: view.tick,
      players: observer.state().players,
      tally: view.tally,
      seats: view.accounts,
      match: view.match,
      youId: view.seats.get(memberId ?? "") ?? -1,
    };
  }, [memberId]);
  const setInputVector = useCallback(
    (vector: [number, number] | null) => input.current.setStick(vector),
    [],
  );
  const setAimVector = useCallback((vector: [number, number] | null) => {
    const angle = aimFromVector(vector);
    input.current.setStickAim(angle);
    input.current.setButton("buttons", "fire", angle !== null);
  }, []);
  const setButton = useCallback(
    (name: ButtonName, pressed: boolean) =>
      input.current.setButton("buttons", name, pressed),
    [],
  );
  const resetTally = useCallback(() => undefined, []);
  const setMatch = useCallback(() => undefined, []);
  return {
    peek,
    resetTally,
    setMatch,
    player,
    receiving,
    setInputVector,
    setAimVector,
    setButton,
  };
}
