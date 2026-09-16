import type { Point } from "../world/projection";
import type { RasterContext } from "./canvasTypes";
import { worldToScreen, type Camera, type Viewport } from "./camera";

/** Paints a translucent road ribbon and evenly spaced chevrons in the direction of travel. */
export function drawNavigation(
  context: RasterContext,
  camera: Camera,
  size: Viewport,
  points: Point[],
): void {
  if (points.length < 2) return;
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = "rgba(34,211,238,0.28)";
  context.lineWidth = camera.zoom * 2.4;
  context.beginPath();
  points.forEach((point, index) => {
    const [x, y] = worldToScreen(camera, size, point);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.strokeStyle = "#a5f3fc";
  context.lineWidth = Math.max(2, camera.zoom * 0.22);
  let nextArrow = 4;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    for (; nextArrow < length; nextArrow += 9) {
      const point: Point = [
        a[0] + Math.cos(angle) * nextArrow,
        a[1] + Math.sin(angle) * nextArrow,
      ];
      const [x, y] = worldToScreen(camera, size, point);
      if (x < -20 || y < -20 || x > size.width + 20 || y > size.height + 20)
        continue;
      context.save();
      context.translate(x, y);
      context.rotate(angle);
      const arm = camera.zoom * 0.9;
      context.beginPath();
      context.moveTo(-arm, -arm);
      context.lineTo(0, 0);
      context.lineTo(-arm, arm);
      context.stroke();
      context.restore();
    }
    nextArrow -= length;
  }
  const [x, y] = worldToScreen(camera, size, points[points.length - 1]);
  context.beginPath();
  context.arc(x, y, camera.zoom * 2, 0, Math.PI * 2);
  context.stroke();
  context.restore();
}
