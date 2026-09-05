import type { GroundKind, LandmarkStyle, RoadClass } from "../world/mapTypes";

/** Ground fills; `urban` is also the chunk background where no polygon exists. */
export const GROUND_FILL: Record<GroundKind, string> = {
  grass: "#6f9f5a",
  field: "#b9ab6f",
  forest: "#3f6f43",
  urban: "#c8c2b4",
};
/** Water fill. */
export const WATER_FILL = "#5f9bd6";
/** Road surface. */
export const ROAD_FILL = "#f2eee6";
/** Dashed centre line on the bigger roads. */
export const ROAD_CENTRE_LINE = "#e0b64a";
/** Pavement colour drawn under zone roads. */
export const PAVEMENT_FILL = "#d8d2c6";
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
/** Roof shade by number of levels. */
export function buildingFill(levels: number): string {
  if (levels <= 1) return "#a89886";
  if (levels === 2) return "#9a8878";
  if (levels <= 4) return "#8c7a6a";
  return "#7c6a5c";
}
/** Building outline. */
export const BUILDING_STROKE = "#4a3f36";
/** Landmark roof colours by style. */
export const LANDMARK_FILL: Record<LandmarkStyle, string> = {
  church: "#b8473f",
  pool: "#4aa3df",
  campus: "#5aa66f",
  cafe: "#d98b3a",
};
/** Label ink colour. */
export const LABEL_FILL = "#1f1a16";
/** Label halo colour drawn behind the ink for contrast. */
export const LABEL_HALO = "rgba(255,255,255,0.85)";
/** Street label size in screen pixels. */
export const STREET_LABEL_PX = 11;
/** Landmark label size in screen pixels. */
export const LANDMARK_LABEL_PX = 13;
/** Hatch background for areas without a loaded tile. */
export const HATCH_BACKGROUND = "#2a2f38";
/** Hatch line colour for areas without a loaded tile. */
export const HATCH_LINE = "#3b4250";
/** Flat colour shown while a chunk is still being rasterised. */
export const PLACEHOLDER_FILL = "#c8c2b4";
/** Player sprite body colour. */
export const PLAYER_FILL = "#f5f5f5";
/** Player sprite outline ring colour. */
export const PLAYER_RING = "#e11d48";
/** Zone boundary ring. */
export const ZONE_RING = "rgba(29,78,216,0.7)";
/** Car body colours indexed by `VehicleState.colour` (six entries, matching `VEHICLE_COLOUR_COUNT`). */
export const CAR_BODY_COLOURS: string[] = [
  "#c0392b",
  "#2e86de",
  "#f1c40f",
  "#27ae60",
  "#8e44ad",
  "#ecf0f1",
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
export const PLAYER_DEAD_FILL = "#6b6b6b";
/** Outline of a dead body. */
export const PLAYER_DEAD_RING = "#3a3a3a";
