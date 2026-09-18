"use client";
import { contactsForMap } from "@/lib/cityArena/missions/world";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import * as Sentry from "@sentry/nextjs";
import {
  createArenaScreenRuntime,
  type ArenaScreenRuntime,
} from "@/lib/cityArena/net/screenRuntime";
import { createBrowserArenaSession } from "@/lib/cityArena/world/browserSession";
import { renderSplitScreen } from "@/lib/cityArena/render/renderSplitScreen";
import {
  updateSplitScreen,
  type SplitScreen,
} from "@/lib/cityArena/render/splitScreen";
import { findZoneByKey } from "@/lib/cityArena/world/zone";
import { fromUnits } from "@/lib/cityArena/world/projection";
import { policeCarIds } from "@/lib/cityArena/sim/police";
import { occupiedVehicle } from "@/lib/cityArena/sim/boarding";
import type { Point } from "@/lib/cityArena/world/projection";
import { loadArenaSettings } from "@/lib/cityArena/storage";
import type { MatchState } from "@/lib/cityArena/net/matchPhase";
import type { MatchSeam, MatchPeek } from "./matchSeam";
import type { ArenaRoom } from "./useArenaRoom";

/** Hosts or observes a shared canvas without allocating an anonymous player's avatar. */
export function useArenaScreenGame(
  room: ArenaRoom,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  onReady: (ready: boolean) => void,
): MatchSeam & { loading: boolean; failure: string | null } {
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const runtimeRef = useRef<ArenaScreenRuntime | null>(null);
  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);
  const roomId = room.ticket?.roomId;
  useEffect(() => {
    if (!roomId) return undefined;
    let disposed = false;
    let frame = 0;
    let last = 0;
    let nextTiles = 0;
    let syncing = false;
    let approved = false;
    let reportedEpoch: number | null = null;
    let split: SplitScreen = { views: [], dividerOpacity: 0 };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const settings = loadArenaSettings();
    const session = createBrowserArenaSession(
      () => {
        if (!disposed)
          setFailure("Een deel van de kaart wordt opnieuw geladen");
      },
      96 * 1024 * 1024,
      true,
    );
    const report = (error: unknown): void => {
      Sentry.captureException(error, {
        tags: { area: "arena", kind: "screen-runtime" },
      });
      if (!disposed)
        setFailure(
          "Het spelbeeld kon niet worden geladen. Verbind het scherm opnieuw.",
        );
    };
    const boot = async (): Promise<void> => {
      const { index } = await session.ready();
      const ticket = roomRef.current.ticket;
      if (disposed || !ticket) return;
      const zone = findZoneByKey(index, ticket.zone);
      const centre: [number, number] = zone
        ? [fromUnits(zone.center[0]), fromUnits(zone.center[1])]
        : [0, 0];
      await session.update(centre);
      if (disposed) return;
      const runtime = createArenaScreenRuntime(
        session,
        ticket,
        () => Date.now() + roomRef.current.clockOffsetMs,
      );
      runtimeRef.current = runtime;
      setLoading(false);
      const draw = (now: number): void => {
        if (disposed) return;
        const current = roomRef.current;
        const live = current.transport();
        if (current.ticket && live)
          runtime.sync(
            current.ticket,
            live,
            current.status === "ready" && current.connection === "connected",
          );
        const dt = last ? Math.min(100, Math.max(0, now - last)) : 0;
        last = now;
        if (!document.hidden) {
          if (!approved && (runtime.hasSnapshot() || !current.ticket?.round)) {
            approved = true;
            onReady(true);
          }
          runtime.advance(dt);
          if (
            !runtime.isPublishing() &&
            current.ticket &&
            reportedEpoch !== current.ticket.epoch
          ) {
            reportedEpoch = current.ticket.epoch;
            current.reportHostLost(current.clientId);
          }
          const state = runtime.view(Date.now() + current.clockOffsetMs);
          if (now >= nextTiles && !syncing) {
            nextTiles = now + 500;
            syncing = true;
            const positions = state.players.length
              ? state.players.map((player): [number, number] => [
                  player.x,
                  player.y,
                ])
              : [centre];
            void Promise.all(positions.map((point) => session.update(point)))
              .catch(report)
              .finally(() => {
                syncing = false;
              });
          }
          const canvas = canvasRef.current;
          const context = canvas?.getContext("2d");
          if (canvas && context) {
            const size = canvas.getBoundingClientRect();
            const dpr = Math.min(1.5, window.devicePixelRatio || 1);
            const width = Math.round(size.width * dpr);
            const height = Math.round(size.height * dpr);
            if (canvas.width !== width || canvas.height !== height) {
              canvas.width = width;
              canvas.height = height;
            }
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            context.clearRect(0, 0, size.width, size.height);
            const seats = runtime.seats();
            const controllers = current.crew.filter(
              (member) =>
                member.role === "controller" || member.role === "hybrid",
            );
            const ids = new Set(
              controllers.map((member) => seats.get(member.clientId)),
            );
            const tracked = controllers.length
              ? state.players.filter((player) => ids.has(player.id))
              : state.players;
            split = updateSplitScreen(
              split,
              tracked.map((candidate) => {
                const vehicle = occupiedVehicle(state, candidate);
                const velocity: Point = vehicle
                  ? [vehicle.velocityX, vehicle.velocityY]
                  : [
                      Math.cos(candidate.facing) * candidate.speed,
                      Math.sin(candidate.facing) * candidate.speed,
                    ];
                return { ...candidate, velocity, driving: vehicle !== null };
              }),
              size,
              dt / 1000,
              reduced.matches,
              settings.dynamicCamera,
            );
            const sprites = session.sprites();
            const names = new Map<number, string>();
            for (const member of current.crew) {
              const id = seats.get(member.clientId);
              if (id !== undefined) names.set(id, member.name);
            }
            renderSplitScreen(
              context,
              split,
              {
                missionContacts: contactsForMap(session.index()),
                missionRound: state.zoneEnforced,
                world: {
                  raster: session.raster,
                  overhead: session.overhead,
                  tiles: session.tiles(),
                  landmarks: session.landmarks(),
                  loadedTileRects: session.loadedTileRects(),
                  rasterBudgetMs: 4,
                },
                zone: state.zoneEnforced ? (zone ?? null) : null,
                players: state.players,
                localPlayerId: -1,
                peds: state.peds,
                cops: state.cops,
                pickups: state.pickups,
                vehicles: state.vehicles,
                bullets: state.bullets,
                effects: reduced.matches ? [] : state.effects,
                sirenVehicleIds: policeCarIds(state),
                tick: state.tick,
                reducedMotion: reduced.matches,
                aimScreen: null,
                pushIn: 1,
                vehicleArt: sprites,
                peopleSprites: sprites.people,
                itemSprites: sprites.items,
                playerSprite: sprites.player,
                basketballSprite: sprites.landmarks?.["basketball-girls"],
              },
              names,
            );
          }
        }
        frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
    };
    void boot().catch(report);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      runtimeRef.current?.stop();
      runtimeRef.current = null;
      session.dispose();
      onReady(false);
    };
  }, [roomId, canvasRef, onReady]);
  const peek = useCallback((): MatchPeek | null => {
    const runtime = runtimeRef.current;
    return runtime
      ? {
          tick: runtime.state().tick,
          players: runtime.state().players,
          youId: -1,
          tally: runtime.tally(),
          seats: runtime.accounts(),
          match: runtime.match(),
        }
      : null;
  }, []);
  const setMatch = useCallback(
    (match: MatchState) => runtimeRef.current?.setMatch(match),
    [],
  );
  const resetTally = useCallback(() => runtimeRef.current?.resetTally(), []);
  return { peek, setMatch, resetTally, loading, failure };
}
