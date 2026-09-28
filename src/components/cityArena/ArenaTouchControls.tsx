"use client";

import type { StickController } from "@/lib/cityArena/input/touchStick";
import { isMelee } from "@/lib/cityArena/sim/weapons";
import ArenaTouchButtons from "./ArenaTouchButtons";
import { ArenaTouchTip } from "./ArenaTouchTip";
import TouchLookPad from "./TouchLookPad";
import TouchStick from "./TouchStick";
import type { ArenaGame, ArenaHud } from "./useArenaGame";

/** Shown on the car button at a landmark while its activity cools down. */
const LANDMARK_COOLDOWN_LABEL = "Even uitrusten";

/** Props for {@link ArenaTouchControls}. */
export type ArenaTouchControlsProps = {
  game: ArenaGame;
  stick: StickController;
  aimStick: StickController;
  tip: { shown: boolean; dismiss: () => void };
  /** A menu, the map or an offer is open over the playfield: the sights go down. */
  paused: boolean;
};

/** What the car button offers besides getting in: a mission's action, else a landmark's. */
function interactionLabel(hud: ArenaHud): string | undefined {
  const missionAction = hud.mission?.action;
  if (missionAction !== undefined && missionAction !== null)
    return missionAction;
  if (!hud.landmark) return undefined;
  return hud.landmark.cooldown > 0
    ? LANDMARK_COOLDOWN_LABEL
    : hud.landmark.action;
}

/** The sights may be up with a gun in hand, alive, and nothing open over the playfield. */
function sightsAllowed(game: ArenaGame, paused: boolean): boolean {
  return !isMelee(game.hud.weapon) && game.death === null && !paused;
}

/**
 * The touch layer over the playfield (spec §7; aim round §6): the movement stick on the left; on
 * the right the aim stick in 2D — which aims and fires — or, in 3D, the look pad, which only
 * turns the camera while the round Schieten button fires, with Richten above it; the buttons;
 * and the first-run tip.
 *
 * @param props - The game, the two sticks, the tip and whether anything is open over the game.
 * @returns The touch controls.
 */
export default function ArenaTouchControls({
  game,
  stick,
  aimStick,
  tip,
  paused,
}: ArenaTouchControlsProps): React.JSX.Element {
  const twinStick = game.settings.twinStick;
  const look3d = game.view3d.active;
  return (
    <>
      <TouchStick stick={stick} onVector={game.setInputVector} />
      {look3d ? <TouchLookPad look={game.view3d.touchLook} /> : null}
      {twinStick && !look3d ? (
        <TouchStick
          side="right"
          stick={aimStick}
          onVector={game.setAimVector}
        />
      ) : null}
      <ArenaTouchButtons
        inVehicle={game.hud.inVehicle}
        canOrderBeer={game.hud.canOrderBeer}
        interactionLabel={interactionLabel(game.hud)}
        onButton={game.setButton}
        showFire={!twinStick}
        look={look3d ? game.view3d.touchLook : undefined}
        sightsAllowed={sightsAllowed(game, paused)}
        onRadio={game.nextStation}
      />
      {tip.shown ? (
        <ArenaTouchTip
          twinStick={twinStick}
          look3d={look3d}
          onDismiss={tip.dismiss}
        />
      ) : null}
    </>
  );
}
