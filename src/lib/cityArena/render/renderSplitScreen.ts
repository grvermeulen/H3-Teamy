import { renderScene, type Scene } from "./renderScene";
import type { SplitScreen } from "./splitScreen";
import type { DrawStats } from "./drawWorld";

/** Composes clipped cameras over a shared world/raster cache and one raster time budget. */
export function renderSplitScreen(
  context: CanvasRenderingContext2D,
  split: SplitScreen,
  scene: Scene,
  names: ReadonlyMap<number, string> = new Map(),
): DrawStats {
  const total: DrawStats = { missing: 0, rasterised: false, rasterMs: 0 };
  const budget = scene.world.rasterBudgetMs ?? 4;
  for (const view of split.views) {
    context.save();
    context.beginPath();
    view.clip.forEach((point, index) =>
      index
        ? context.lineTo(point[0], point[1])
        : context.moveTo(point[0], point[1]),
    );
    context.closePath();
    context.clip();
    const ratio = view.zoom / view.camera.zoom;
    const centreX = view.rect.x + view.rect.width / 2;
    const centreY = view.rect.y + view.rect.height / 2;
    context.translate(centreX, centreY);
    context.scale(ratio, ratio);
    context.translate(-centreX, -centreY);
    const stats = renderScene(
      context,
      {
        camera: view.camera,
        rect: {
          x: centreX - view.rect.width / ratio / 2,
          y: centreY - view.rect.height / ratio / 2,
          width: view.rect.width / ratio,
          height: view.rect.height / ratio,
        },
      },
      {
        ...scene,
        navigation: view.ids.includes(scene.localPlayerId)
          ? scene.navigation
          : undefined,
        world: {
          ...scene.world,
          rasterBudgetMs: Math.max(0, budget - total.rasterMs),
        },
        localPlayerId: view.ids.includes(scene.localPlayerId)
          ? scene.localPlayerId
          : view.ids[0]!,
        aimScreen: null,
        pushIn: 1,
        drunk: 0,
        shake: undefined,
      },
    );
    total.missing += stats.missing;
    total.rasterised ||= stats.rasterised;
    total.rasterMs += stats.rasterMs;
    context.restore();
  }
  for (const view of split.views) {
    context.save();
    context.globalAlpha = split.dividerOpacity;
    context.strokeStyle = "#f5a524";
    context.lineWidth = 2;
    context.beginPath();
    view.clip.forEach((point, index) =>
      index
        ? context.lineTo(point[0], point[1])
        : context.moveTo(point[0], point[1]),
    );
    context.closePath();
    context.stroke();
    context.restore();
    const label = view.ids
      .map((id) => names.get(id) ?? `Speler ${id + 1}`)
      .join(" · ");
    context.save();
    context.font = "bold 14px sans-serif";
    context.textAlign = "center";
    context.fillStyle = "#07090b";
    const x =
      view.clip.reduce((sum, point) => sum + point[0], 0) / view.clip.length;
    const y =
      view.clip.reduce((sum, point) => sum + point[1], 0) / view.clip.length;
    const width = Math.min(
      view.rect.width - 12,
      context.measureText(label).width + 20,
    );
    context.fillRect(x - width / 2, y - view.rect.height / 4 - 18, width, 26);
    context.fillStyle = "#f5a524";
    context.fillText(label, x, y - view.rect.height / 4, width - 12);
    context.restore();
  }
  return total;
}
