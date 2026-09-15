import {
  BASKETBALL_COURT_ANGLE,
  BASKETBALL_COURT_CENTRE,
} from "../world/basketballCourt";
import { worldToScreen, type Camera, type Viewport } from "./camera";
import type { RasterContext } from "./canvasTypes";
import type { PropSprite } from "./sprites";

/** A small driveway court with two curly-haired Oranje players and a bouncing ball. */
export function drawBasketball(
  context: RasterContext,
  camera: Camera,
  size: Viewport,
  tick: number,
  sprite?: PropSprite,
): void {
  const [x, y] = worldToScreen(camera, size, BASKETBALL_COURT_CENTRE);
  if (x < -100 || y < -100 || x > size.width + 100 || y > size.height + 100)
    return;
  context.save();
  context.translate(x, y);
  context.scale(camera.zoom, camera.zoom);
  context.rotate(BASKETBALL_COURT_ANGLE);
  context.fillStyle = "#776f62";
  context.fillRect(-3.4, -2.1, 6.8, 4.2);
  context.strokeStyle = "#ece0bc";
  context.lineWidth = 0.08;
  context.beginPath();
  context.rect(-3.1, -1.8, 6.2, 3.6);
  context.rect(0.8, -0.9, 2.3, 1.8);
  context.stroke();
  context.beginPath();
  context.arc(0.8, 0, 0.9, Math.PI / 2, Math.PI * 1.5);
  context.stroke();
  context.fillStyle = "#cbd6d6";
  context.fillRect(2.9, -0.7, 0.18, 1.4);
  context.strokeStyle = "#f18b3e";
  context.lineWidth = 0.12;
  context.beginPath();
  context.arc(2.65, 0, 0.25, 0, Math.PI * 2);
  context.stroke();
  context.restore();
  context.save();
  context.translate(x, y);
  context.scale(camera.zoom, camera.zoom);
  if (sprite) {
    const height = (3.4 * sprite.widthMetres) / sprite.lengthMetres;
    context.drawImage(sprite.image, -1.9, -height / 2, 3.4, height);
  } else {
    for (const px of [-1.2, 1]) {
      context.fillStyle = "#f07c24";
      context.fillRect(px - 0.25, -0.2, 0.5, 0.9);
      context.fillStyle = "#4c3026";
      context.beginPath();
      context.arc(px, -0.4, 0.3, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#e9e4d9";
      context.fillRect(px - 0.24, 0.7, 0.2, 0.35);
      context.fillRect(px + 0.04, 0.7, 0.2, 0.35);
    }
  }
  const bounce = Math.abs(Math.sin((tick * Math.PI) / 18));
  context.fillStyle = "#e87930";
  context.beginPath();
  context.arc(-0.45, 0.55 - bounce * 0.55, 0.16, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#6b3826";
  context.lineWidth = 0.025;
  context.stroke();
  context.restore();
}
