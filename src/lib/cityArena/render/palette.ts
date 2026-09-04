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
