"use client";
import { useEffect, type RefObject } from "react";
import {
  loadMissionProgress,
  saveMissionProgress,
} from "@/lib/cityArena/missions/progression";
import { myPlayer, type Runtime } from "./arenaRuntime";

/** Offline-only story persistence; networked rooms always start from their authoritative state. */
export function useArenaMissionSave(
  runtimeRef: RefObject<Runtime | null>,
  enabled: boolean,
): void {
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!enabled || !runtime || runtime.netplay.kind !== "offline") return;
    const saved = loadMissionProgress();
    if (saved)
      runtime.state = {
        ...runtime.state,
        tick: saved.tick,
        players: runtime.state.players.map((player) =>
          player.id === myPlayer(runtime).id
            ? { ...player, mission: saved.profile }
            : player,
        ),
      };
    const save = () => {
      if (runtime.netplay.kind !== "offline") return;
      const profile = myPlayer(runtime).mission;
      if (profile) saveMissionProgress(profile, runtime.state.tick);
    };
    const interval = window.setInterval(save, 1000);
    window.addEventListener("pagehide", save);
    return () => {
      save();
      window.clearInterval(interval);
      window.removeEventListener("pagehide", save);
    };
  }, [enabled, runtimeRef]);
}
