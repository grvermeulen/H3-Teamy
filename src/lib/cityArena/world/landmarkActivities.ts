import { nearestPointOnRing, type CollisionGrid } from "./collisionGrid";
import { pointInPolygon } from "../mapBuild/geometry";
import type { MapIndex } from "./mapTypes";
import { landmarkCentreMetres } from "./zone";
import type { ArenaPlayerState } from "../sim/types";
import type { BonusKind } from "../sim/landmarkBonuses";
import { BASKETBALL_COURT_CENTRE } from "./basketballCourt";

/** A landmark's short activity and its temporary reward. */
export type LandmarkActivity = {
  action: string;
  description: string;
  bonus: BonusKind;
  seconds: number;
};
/** Authored activities for the places marked on the original map. */
export const LANDMARK_ACTIVITIES: Record<string, LandmarkActivity> = {
  "bellefleur-basketball": {
    action: "Doe mee met de warming-up",
    description: "Geef het Oranje-duo een high five en oefen je voetenwerk.",
    bonus: "speed",
    seconds: 90,
  },
  "klein-zwitserland": {
    action: "Proosten",
    description:
      "Hef het glas op de brouwers. Het bier blijft wel naar je hoofd stijgen!",
    bonus: "guard",
    seconds: 75,
  },
  gastland: {
    action: "Baantje trekken",
    description:
      "Een frisse duik en een snelle borstcrawl maken je benen wakker.",
    bonus: "speed",
    seconds: 120,
  },
  "onder-de-linden": {
    action: "Koffiepauze",
    description: "Kom op adem met koffie onder de lindeboom.",
    bonus: "recovery",
    seconds: 75,
  },
  cunerakerk: {
    action: "Klok luiden",
    description: "Laat de Cuneraklok klinken en neem haar bescherming mee.",
    bonus: "guard",
    seconds: 120,
  },
  "grote-kerk-wageningen": {
    action: "Kaarsje aansteken",
    description: "Een rustig moment bij het kaarslicht geeft nieuwe energie.",
    bonus: "recovery",
    seconds: 90,
  },
  "oude-kerk-bennekom": {
    action: "Luister naar het carillon",
    description: "Volg het ritme van de klokken en vind je concentratie terug.",
    bonus: "focus",
    seconds: 105,
  },
  "de-bongerd": {
    action: "Watertraining",
    description: "Een korte aquafittraining zet je spieren aan het werk.",
    bonus: "power",
    seconds: 120,
  },
  "vrije-slag": {
    action: "Van de glijbaan",
    description: "Een plons, een lach en genoeg energie voor een sprint.",
    bonus: "speed",
    seconds: 135,
  },
  "wur-forum": {
    action: "Breinbreker oplossen",
    description: "Los de campuspuzzel op voor een scherpere focus.",
    bonus: "focus",
    seconds: 120,
  },
  "wur-orion": {
    action: "Sportexperiment",
    description: "Test de nieuwste warming-up van de studenten.",
    bonus: "speed",
    seconds: 105,
  },
  "wur-atlas": {
    action: "Groene smoothie",
    description: "Proef de oogst uit de campustuin en laad jezelf weer op.",
    bonus: "recovery",
    seconds: 90,
  },
};

/** Finds a nearby activity along the outside walls, including large pool and campus buildings. */
export function nearbyLandmarkActivity(
  index: Pick<MapIndex, "landmarks">,
  player: ArenaPlayerState,
  collision?: Pick<CollisionGrid, "query">,
): { key: string; name: string; activity: LandmarkActivity } | null {
  if (player.diedAtTick !== null || player.vehicleId !== null) return null;
  let nearest: ReturnType<typeof nearbyLandmarkActivity> = null;
  let best = Infinity;
  const courtDistance = Math.hypot(
    player.x - BASKETBALL_COURT_CENTRE[0],
    player.y - BASKETBALL_COURT_CENTRE[1],
  );
  if (courtDistance <= 5) {
    nearest = {
      key: "bellefleur-basketball",
      name: "Basketbal · Bellefleur 5",
      activity: LANDMARK_ACTIVITIES["bellefleur-basketball"],
    };
    best = courtDistance;
  }
  for (const landmark of index.landmarks) {
    const activity = LANDMARK_ACTIVITIES[landmark.key];
    if (!activity) continue;
    const [x, y] = landmarkCentreMetres(landmark);
    let distance = Math.hypot(player.x - x, player.y - y);
    if (distance > 180) continue;
    const building = collision
      ?.query({ minX: x - 1, minY: y - 1, maxX: x + 1, maxY: y + 1 })
      .find(
        (obstacle) =>
          obstacle.kind === "building" && pointInPolygon([x, y], obstacle.ring),
      );
    if (building && landmark.style !== "brewery")
      distance = nearestPointOnRing(
        [player.x, player.y],
        building.ring,
      ).distance;
    const range = landmark.style === "brewery" ? 10 : 4;
    if (distance <= range && distance < best) {
      best = distance;
      nearest = { key: landmark.key, name: landmark.name, activity };
    }
  }
  return nearest;
}
