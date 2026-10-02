import { missionById } from "../missions/catalog";
import { missionScenario } from "../missions/scenarios";
import type { MissionContact } from "../missions/contacts";
import {
  emptyMissionProfile,
  missionAnchor,
  missionTargetReferences,
  missionTargets,
  missionUnavailable,
} from "../missions/world";
import type { ArenaPlayerState, ArenaState } from "../sim/types";
import { worldToScreen, type Camera, type Viewport } from "./camera";
import type { RasterContext } from "./canvasTypes";
import { drawPedestrian } from "./drawPeople";
import type { PersonSprites } from "./sprites";
import { boundMissionActors } from "../missions/actors";

/** Destructible equipment is drawn as equipment, while retaining ordinary bullet collision. */
export function drawMissionProps(
  context: RasterContext,
  camera: Camera,
  size: Viewport,
  state: Pick<ArenaState, "players" | "peds">,
): Set<number> {
  const props = boundMissionActors(state).filter(
    ({ spec }) => spec.kind === "prop",
  );
  context.save();
  for (const { spec, binding } of props) {
    const ped = state.peds.find((entry) => entry.id === binding.id);
    if (!ped) continue;
    const [x, y] = worldToScreen(camera, size, [ped.x, ped.y]);
    if (x < -40 || y < -40 || x > size.width + 40 || y > size.height + 40)
      continue;
    const width = Math.max(12, camera.zoom * 1.8);
    context.fillStyle = ped.health > 0 ? "#386074" : "#423f3e";
    context.fillRect(x - width / 2, y - width / 2, width, width);
    context.fillStyle = "#5eead4";
    context.fillRect(
      x - width / 2,
      y + width / 2 + 3,
      (width * ped.health) / 100,
      3,
    );
    context.font = "11px sans-serif";
    context.textAlign = "center";
    context.fillText(spec.alias.replaceAll("-", " "), x, y - width / 2 - 5);
  }
  context.restore();
  return new Set(props.map(({ binding }) => binding.id));
}

/** Persistent named contacts and objective markers, separate from recyclable ambient people. */
export function drawMissions(
  context: RasterContext,
  camera: Camera,
  size: Viewport,
  contacts: readonly MissionContact[],
  player: ArenaPlayerState | undefined,
  tick: number,
  round: boolean,
  people?: PersonSprites,
  state?: Pick<ArenaState, "peds" | "vehicles">,
): void {
  context.save();
  context.textAlign = "center";
  context.font = "bold 12px sans-serif";
  for (const contact of contacts) {
    const point = missionAnchor(contact.id);
    if (!point) continue;
    const [x, y] = worldToScreen(camera, size, point);
    if (x < -100 || y < -50 || x > size.width + 100 || y > size.height + 50)
      continue;
    drawPedestrian(
      context,
      camera,
      size,
      {
        id: contact.look,
        x: point[0],
        y: point[1],
        facing: Math.PI / 2,
        health: 100,
        mode: "walk",
        modeUntilTick: 0,
        rail: null,
        fleeX: 0,
        fleeY: 0,
      },
      people,
      0,
    );
    const available = contact.missions.some((id) => {
      const definition = missionById(id);
      return (
        definition &&
        !missionUnavailable(
          definition,
          player?.mission ?? emptyMissionProfile(),
          tick,
          round,
        )
      );
    });
    context.fillStyle = available ? contact.colour : "#b4b4bd";
    context.fillText(`${available ? "€" : "◇"} ${contact.name}`, x, y - 22);
  }
  const run = player?.mission?.run;
  const definition = run && missionById(run.definitionId);
  if (player && definition) {
    const targets = missionTargets(definition, state, player.mission);
    const scenario = missionScenario(definition);
    const optional = [scenario.recharge, scenario.optionalPickup?.alias].filter(
      (alias): alias is string => !!alias && !run!.inventory.includes(alias),
    );
    for (const alias of [...missionTargetReferences(player), ...optional]) {
      const target = targets[alias];
      if (!target) continue;
      const [x, y] = worldToScreen(camera, size, target.position);
      if (x < -80 || y < -80 || x > size.width + 80 || y > size.height + 80)
        continue;
      context.strokeStyle = optional.includes(alias) ? "#67e8f9" : "#fde047";
      context.fillStyle = context.strokeStyle;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(x, y, Math.max(10, camera.zoom * 2.5), 0, Math.PI * 2);
      context.stroke();
      context.fillText("▼", x, y - Math.max(16, camera.zoom * 3));
      if (target.clues?.length)
        context.fillText(
          target.clues.map((clue) => clue.replaceAll("-", " ")).join(" · "),
          x,
          y - Math.max(32, camera.zoom * 5),
        );
    }
  }
  context.restore();
}
