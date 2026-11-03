import { useId, useMemo } from "react";
import {
  DIAGRAM_HEIGHT,
  DIAGRAM_WIDTH,
  type DiagramArrow,
  type DiagramFrame,
  type DiagramPlayer,
} from "../../lib/schemas/speelboek";

const CAP = {
  WHITE: { fill: "#f3f6fb", text: "#0b0f14" },
  BLUE: { fill: "#2563eb", text: "#ffffff" },
  RED: "#dc2626",
} as const;
const BALL = "#ffd60a";
const LINE = "#e8f0fe";
const PASS = "#00d4ff";

type Props = {
  frame: DiagramFrame;
  /** Cap text per player id (from the drill roster); players without a label get a blank cap. */
  labels?: Record<string, string>;
  /** Player to draw a dashed highlight ring around. */
  selectedPlayerId?: string;
  /** Thumbnail mode: no distance labels, thinner strokes. */
  mini?: boolean;
  /** Accessible description of the frame. */
  title?: string;
  className?: string;
};

function capColors(
  player: DiagramPlayer,
  attackColor: DiagramFrame["attackColor"],
): { fill: string; text: string } {
  const defenceColor = attackColor === "WHITE" ? "BLUE" : "WHITE";
  switch (player.team) {
    case "OFF":
      return CAP[attackColor];
    case "DEF":
      return CAP[defenceColor];
    case "GK":
      // Red cap; the number takes the defending team's colour.
      return {
        fill: CAP.RED,
        text: defenceColor === "BLUE" ? "#ffffff" : CAP.BLUE.fill,
      };
    default: {
      const exhaustive: never = player.team;
      return exhaustive;
    }
  }
}

function arrowPath(arrow: DiagramArrow, from: DiagramPlayer): string {
  const [tx, ty] = arrow.to;
  if (arrow.via) {
    const [vx, vy] = arrow.via;
    return `M${from.x} ${from.y} Q${vx} ${vy} ${tx} ${ty}`;
  }
  return `M${from.x} ${from.y} L${tx} ${ty}`;
}

/**
 * Top-down half-pool diagram (goal at the top) rendering one {@link DiagramFrame}:
 * caps in waterpolo colours (attack white or blue, defence the other colour, keeper red),
 * a yellow ball and swim/pass/shot arrows. Players are keyed by id so position changes
 * between frames animate with a short CSS transition.
 *
 * @param frame - Positions, arrows and ball holder to draw.
 * @param labels - Cap text per player id; omitted players get a blank cap.
 * @param selectedPlayerId - Player to highlight with a dashed ring.
 * @param mini - Thumbnail rendering without distance labels.
 * @param title - Accessible title for the SVG.
 * @param className - Extra classes on the `<svg>`.
 */
export default function PoolDiagram({
  frame,
  labels = {},
  selectedPlayerId,
  mini = false,
  title,
  className,
}: Props) {
  const reactId = useId();
  const { arrowId, passId } = useMemo(() => {
    const uid = reactId.replace(/:/g, "");
    return { arrowId: `${uid}-arrow`, passId: `${uid}-pass` };
  }, [reactId]);
  const byId = new Map(frame.players.map((p) => [p.id, p]));
  const ballHolder = frame.ballPlayerId
    ? byId.get(frame.ballPlayerId)
    : undefined;
  const capRadius = mini ? 8 : 9.5;

  return (
    <svg
      viewBox={`0 0 ${DIAGRAM_WIDTH} ${DIAGRAM_HEIGHT}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={className}
    >
      <defs>
        <marker
          id={arrowId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" fill={LINE} />
        </marker>
        <marker
          id={passId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" fill={PASS} />
        </marker>
      </defs>

      <rect
        width={DIAGRAM_WIDTH}
        height={DIAGRAM_HEIGHT}
        rx="6"
        fill="rgba(0,212,255,0.06)"
      />
      <line
        x1="0"
        y1="10"
        x2={DIAGRAM_WIDTH}
        y2="10"
        stroke="rgba(255,255,255,0.35)"
      />
      <line
        x1="0"
        y1="40"
        x2={DIAGRAM_WIDTH}
        y2="40"
        stroke="#ff6b6b"
        strokeOpacity="0.55"
      />
      <line
        x1="0"
        y1="85"
        x2={DIAGRAM_WIDTH}
        y2="85"
        stroke="#fbbf24"
        strokeOpacity="0.45"
      />
      <line
        x1="0"
        y1="100"
        x2={DIAGRAM_WIDTH}
        y2="100"
        stroke="#33d17a"
        strokeOpacity="0.4"
        strokeDasharray="4 3"
      />
      <rect
        x="127.5"
        y="3"
        width="45"
        height="8"
        rx="1.5"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      {mini ? null : (
        <g fill="#9fb0c3" fontSize="8">
          <text x="6" y="43">
            2m
          </text>
          <text x="6" y="86">
            5m
          </text>
          <text x="6" y="101">
            6m
          </text>
        </g>
      )}

      {frame.arrows.map((arrow, i) => {
        const from = byId.get(arrow.playerId);
        if (!from) return null;
        const d = arrowPath(arrow, from);
        switch (arrow.kind) {
          case "MOVE":
            return (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={LINE}
                strokeWidth="2"
                markerEnd={`url(#${arrowId})`}
              />
            );
          case "PASS":
            return (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={PASS}
                strokeWidth="2"
                strokeDasharray="5 4"
                markerEnd={`url(#${passId})`}
              />
            );
          case "SHOT":
            return (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={LINE}
                strokeWidth="3.2"
                markerEnd={`url(#${arrowId})`}
              />
            );
          default: {
            const exhaustive: never = arrow.kind;
            return exhaustive;
          }
        }
      })}

      {frame.players.map((p) => {
        const colors = capColors(p, frame.attackColor);
        const label = labels[p.id] ?? "";
        return (
          <g
            key={p.id}
            data-player-id={p.id}
            className="[transition:transform_500ms_ease]"
            // Geometry is data-driven; a Tailwind class cannot express a per-player translate.
            style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
          >
            {p.id === selectedPlayerId ? (
              <circle
                r={capRadius + 4.5}
                fill="none"
                stroke={PASS}
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />
            ) : null}
            <circle
              r={capRadius}
              fill={colors.fill}
              stroke="#0b0f14"
              strokeWidth="1.5"
            />
            {label ? (
              <text
                y="3.5"
                textAnchor="middle"
                fontSize={mini ? 8 : 9.5}
                fontWeight="700"
                fill={colors.text}
              >
                {label}
              </text>
            ) : null}
          </g>
        );
      })}

      {ballHolder ? (
        <circle
          data-ball=""
          className="[transition:cx_500ms_ease,cy_500ms_ease]"
          cx={ballHolder.x + 10}
          cy={ballHolder.y - 9}
          r={mini ? 4 : 5.2}
          fill={BALL}
          stroke="#0b0f14"
          strokeWidth="1.2"
        />
      ) : null}
    </svg>
  );
}
