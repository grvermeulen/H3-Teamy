/** Props for {@link CityArenaLaunchIcon}. */
type CityArenaLaunchIconProps = {
  size?: number;
  decorative?: boolean;
  className?: string;
};

/** Path data for the winding road, shared by its base stroke and dashed centre line. */
const ROAD_PATH_DATA = "M8 34 C 18 30, 22 22, 40 18";

/** Fill of the rounded card frame behind the road glyph. */
const ICON_FRAME_FILL = "#0d1117";
/** Border colour of the rounded card frame. */
const ICON_FRAME_STROKE = "#30363d";
/** Colour of the road's thick base stroke. */
const ROAD_BASE_COLOR = "#f2eee6";
/** Colour of the road's dashed centre line. */
const ROAD_CENTRELINE_COLOR = "#e0b64a";
/** Fill of the destination marker. */
const MARKER_FILL = "#e11d48";
/** Border colour of the destination marker. */
const MARKER_STROKE = "#fff";

/** Rounded card frame behind the road glyph. */
function IconFrame(): React.JSX.Element {
  return (
    <rect
      x="4"
      y="4"
      width="40"
      height="40"
      rx="8"
      fill={ICON_FRAME_FILL}
      stroke={ICON_FRAME_STROKE}
      strokeWidth="2"
    />
  );
}

/** The winding road: a thick base stroke plus a dashed centre line. */
function RoadPath(): React.JSX.Element {
  return (
    <>
      <path
        d={ROAD_PATH_DATA}
        stroke={ROAD_BASE_COLOR}
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d={ROAD_PATH_DATA}
        stroke={ROAD_CENTRELINE_COLOR}
        strokeWidth="1"
        strokeDasharray="3 3"
        fill="none"
      />
    </>
  );
}

/** The destination marker at the road's far end. */
function LocationMarker(): React.JSX.Element {
  return (
    <circle
      cx="30"
      cy="14"
      r="5"
      fill={MARKER_FILL}
      stroke={MARKER_STROKE}
      strokeWidth="2"
    />
  );
}

/** A small road-and-marker glyph for the launcher card. */
export function CityArenaLaunchIcon({
  size = 36,
  decorative = false,
  className,
}: CityArenaLaunchIconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : "Stadsstrijd"}
    >
      <IconFrame />
      <RoadPath />
      <LocationMarker />
    </svg>
  );
}
