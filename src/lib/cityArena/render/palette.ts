import type { GroundKind, LandmarkStyle, RoadClass } from "../world/mapTypes";

/**
 * Ground fills; `urban` is also the chunk background where no polygon exists, so it covers most
 * of the screen. The whole map palette is keyed to the generated tarmac texture (a near-black
 * `#383836`) rather than to the light "paper map" look it replaced.
 *
 * Each value is the mean tone of that kind's texture, so the flat fill a chunk is painted with
 * before the art loads does not visibly pop when the pattern replaces it.
 */
export const GROUND_FILL: Record<GroundKind, string> = {
  grass: "#414927",
  field: "#554a3a",
  forest: "#262d1e",
  urban: "#232529",
};
/** Water fill, and the fallback under the river texture; matches that texture's mean tone. */
export const WATER_FILL = "#163036";
/** Road surface, and the fallback under the tarmac texture; matches that texture's mean tone. */
export const ROAD_FILL = "#383836";
/** Dashed centre line on the bigger roads; the one warm accent on the asphalt. */
export const ROAD_CENTRE_LINE = "#c9a23f";
/**
 * Pavement colour drawn under zone roads, and the fallback under the slab texture. Kept light
 * against the asphalt: the pale band on each side is what makes a road read as a road.
 */
export const PAVEMENT_FILL = "#a09d98";
/** Pavement width on each side of the road, metres. */
export const PAVEMENT_WIDTH_M = 2;
/** Road widths in metres by class (spec §4). */
export const ROAD_WIDTH_M: Record<RoadClass, number> = {
  motorway: 12,
  trunk: 10,
  primary: 9,
  secondary: 8,
  tertiary: 7,
  unclassified: 6,
  residential: 6,
  living_street: 5,
  pedestrian: 4,
  service: 4,
};
/** Classes that get a dashed centre line. */
export const CENTRE_LINE_CLASSES: RoadClass[] = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
];
/** Classes that get pavements. */
export const PAVEMENT_CLASSES: RoadClass[] = [
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "living_street",
];
/** Roof shade by number of levels; taller blocks sit darker, all warmer than the urban ground. */
export function buildingFill(levels: number): string {
  if (levels <= 1) return "#55504a";
  if (levels === 2) return "#4a453f";
  if (levels <= 4) return "#403c36";
  return "#36332e";
}
/** Building outline, lighter than the roofs so blocks keep their edge on the dark ground. */
export const BUILDING_STROKE = "#5c554d";
/** Landmark roof colours by style; the saturated exception that marks a building as a landmark. */
export const LANDMARK_FILL: Record<LandmarkStyle, string> = {
  church: "#a03b34",
  pool: "#2f7fb5",
  campus: "#3f8552",
  cafe: "#b8702c",
};
/** Label ink colour, light now that it is read against dark asphalt and roofs. */
export const LABEL_FILL = "#e8e4dc";
/** Label halo colour drawn behind the ink for contrast. */
export const LABEL_HALO = "rgba(0,0,0,0.75)";
/** Street label size in screen pixels. */
export const STREET_LABEL_PX = 11;
/** Landmark label size in screen pixels. */
export const LANDMARK_LABEL_PX = 13;
/** Hatch background for areas without a loaded tile. */
export const HATCH_BACKGROUND = "#2a2f38";
/** Hatch line colour for areas without a loaded tile. */
export const HATCH_LINE = "#3b4250";
/** Flat colour shown while a chunk is still being rasterised; matches the urban ground so a
 *  chunk does not flash a different tone before its raster arrives. */
export const PLACEHOLDER_FILL = "#1e2024";
/** Player sprite body colour. */
export const PLAYER_FILL = "#f5f5f5";
/** Player sprite outline ring colour. */
export const PLAYER_RING = "#e11d48";
/** Zone boundary ring. */
export const ZONE_RING = "rgba(29,78,216,0.7)";
/** Car body colours indexed by `VehicleState.colour` (ten entries, matching `VEHICLE_COLOUR_COUNT`). */
export const CAR_BODY_COLOURS: string[] = [
  "#c0392b",
  "#2e86de",
  "#f1c40f",
  "#27ae60",
  "#8e44ad",
  "#ecf0f1",
  "#e67e22",
  "#16a085",
  "#7f8c8d",
  "#2c3e50",
];
/** Car window glass. */
export const CAR_WINDOW = "#1b2631";
/** Headlight lenses. */
export const CAR_HEADLIGHT = "#fff3b0";
/** Burnt-out wreck. */
export const CAR_WRECK = "#3d3d3d";
/** Smoke puffs of a damaged car. */
export const CAR_SMOKE = "rgba(90,90,90,0.55)";
/** Bullet tracer. */
export const BULLET_STROKE = "#fff8dc";
/** Muzzle flash. */
export const MUZZLE_FILL = "#ffd54a";
/** Impact dot. */
export const IMPACT_FILL = "#f5f5f5";
/** Explosion disc. */
export const EXPLOSION_FILL = "rgba(255,140,0,0.8)";
/** Explosion ring. */
export const EXPLOSION_RING = "#ff5722";
/** Mouse crosshair. */
export const CROSSHAIR_STROKE = "rgba(255,255,255,0.9)";
/** Body of a player waiting to respawn. */
/** Another player's body fill: paler than your own, still legible on the dark ground. */
export const PLAYER_OTHER_FILL = "#dbeafe";
/** Another player's ring. Sky against your crimson, so you can always find yourself. */
export const PLAYER_OTHER_RING = "#38bdf8";
/** Dead player fill. */
export const PLAYER_DEAD_FILL = "#6b6b6b";
/** Outline of a dead body. */
export const PLAYER_DEAD_RING = "#3a3a3a";
/** Pedestrian body colour. */
export const PED_FILL = "#f59e0b";
/** Pedestrian outline. */
export const PED_RING = "#78350f";
/** Dead pedestrian body colour. */
export const PED_DEAD_FILL = "#77706a";
/** Police officer body colour. */
export const COP_FILL = "#1d4ed8";
/** Police officer badge/accent colour. */
export const COP_ACCENT = "#bfdbfe";
/** Dead police officer body colour. */
export const COP_DEAD_FILL = "#4b5563";
/** Damaged-person health cue. */
export const PERSON_HEALTH = "#ef4444";
/** Weapon pickup colours by weapon kind. */
export const PICKUP_UZI = "#16a34a";
export const PICKUP_SHOTGUN = "#f97316";
/** Health pickup diamond. */
export const PICKUP_HEALTH = "#22c55e";
/** Health pickup cross. */
export const PICKUP_HEALTH_CROSS = "#ffffff";
/** Police light bar colours. */
export const POLICE_LIGHT_BLUE = "#2563eb";
export const POLICE_LIGHT_RED = "#dc2626";
/** Radar background and road colours. */
export const RADAR_BACKGROUND = "rgba(15,23,42,0.9)";
export const RADAR_ROAD = "rgba(226,232,240,0.7)";
export const RADAR_ZONE = "#60a5fa";
export const RADAR_POLICE = "#38bdf8";
export const RADAR_PLAYER = "#f8fafc";
