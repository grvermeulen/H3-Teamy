import type { MapIndex } from "../world/mapTypes";
import { fromUnits, type Point } from "../world/projection";
import type { RoadGraph } from "../world/roadGraph";
import type { RadarSnapshot } from "./radar";
import type { Viewport } from "./camera";

/** Shared world metadata; the map uses the loaded graph without downloading extra tiles. */
export type NavigationMapData = {
  index: MapIndex;
  graph: RoadGraph;
  missions?: import("../missions/hud").MissionMapMarker[];
};
/** A freely pannable north-up map, in CSS pixels per metre. */
export type MapView = { center: Point; scale: number };

/** Converts a position inside the map viewport into world metres. */
export function mapWorldPoint(
  view: MapView,
  size: Viewport,
  point: Point,
): Point {
  return [
    view.center[0] + (point[0] - size.width / 2) / view.scale,
    view.center[1] + (point[1] - size.height / 2) / view.scale,
  ];
}

/** Draws the street map, place names, match boundary, player and active route. */
export function drawNavigationMap(
  ctx: CanvasRenderingContext2D,
  size: Viewport,
  view: MapView,
  data: NavigationMapData,
  radar: RadarSnapshot,
): void {
  const screen = (point: Point): Point => [
    size.width / 2 + (point[0] - view.center[0]) * view.scale,
    size.height / 2 + (point[1] - view.center[1]) * view.scale,
  ];
  const visible = (point: Point): boolean =>
    point[0] > -80 &&
    point[0] < size.width + 80 &&
    point[1] > -40 &&
    point[1] < size.height + 40;
  ctx.fillStyle = "#0c171d";
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const labels = new Set<string>();
  for (const edge of data.graph.edges) {
    const a = screen(data.graph.nodes[edge.a]);
    const b = screen(data.graph.nodes[edge.b]);
    if (
      Math.max(a[0], b[0]) < 0 ||
      Math.min(a[0], b[0]) > size.width ||
      Math.max(a[1], b[1]) < 0 ||
      Math.min(a[1], b[1]) > size.height
    )
      continue;
    ctx.strokeStyle = edge.roadClass === "service" ? "#29404a" : "#526872";
    ctx.lineWidth = Math.min(9, Math.max(1.2, view.scale * 5));
    ctx.beginPath();
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.stroke();
    if (
      view.scale >= 0.65 &&
      edge.name &&
      !labels.has(edge.name) &&
      Math.hypot(a[0] - b[0], a[1] - b[1]) > 70
    ) {
      labels.add(edge.name);
      ctx.fillStyle = "#a9bcc4";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(edge.name, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 7);
    }
  }
  if (radar.zoneCentre && radar.zoneRadiusM !== null) {
    ctx.strokeStyle = "#6685b3";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.arc(
      ...screen(radar.zoneCentre),
      radar.zoneRadiusM * view.scale,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const zone of data.index.zones) {
    const point = screen([
      fromUnits(zone.center[0]),
      fromUnits(zone.center[1]),
    ]);
    if (!visible(point)) continue;
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#8aa6b3";
    ctx.fillText(zone.name, ...point);
  }
  for (const landmark of data.index.landmarks) {
    const [x, y] = screen([
      fromUnits(landmark.center[0]),
      fromUnits(landmark.center[1]),
    ]);
    if (!visible([x, y])) continue;
    ctx.fillStyle = "#f5c976";
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    if (view.scale >= 0.15) {
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(landmark.name, x, y - 9);
    }
  }
  const route = radar.navigation;
  for (const marker of data.missions ?? []) {
    const [x, y] = screen(marker.position);
    if (!visible([x, y])) continue;
    ctx.fillStyle =
      marker.state === "active"
        ? "#fde047"
        : marker.state === "available"
          ? "#6ee7b7"
          : "#cbd5e1";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      `${marker.state === "active" ? "▼" : marker.state === "completed" ? "✓" : marker.state === "locked" ? "◇" : "€"} ${marker.title}`,
      x,
      y - 12,
    );
  }
  if (route) {
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 4;
    ctx.beginPath();
    route.points.forEach((point, i) => {
      const p = screen(point);
      if (i === 0) ctx.moveTo(...p);
      else ctx.lineTo(...p);
    });
    ctx.stroke();
    const [x, y] = screen(route.destination);
    ctx.fillStyle = route.status === "unreachable" ? "#fb7185" : "#22d3ee";
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0c171d";
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  const player = screen(radar.player);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#0c171d";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(...player, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
