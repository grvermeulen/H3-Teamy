import { createDomCanvasFactory } from "../render/canvasTypes";
import { createSpriteStore } from "../render/loadSprites";
import { WHOLE_WORLD_RECT } from "../render/staticRaster";
import { createMapLoader } from "./mapLoader";
import { createWorldSession, type WorldSession } from "./worldSession";

/** One shared sprite/raster store per canvas; TV/host sessions may retain all 35 regional tiles. */
export function createBrowserArenaSession(
  onFailed: () => void,
  rasterBudgetBytes?: number,
  multiView = false,
): WorldSession {
  const loader = createMapLoader({
    onError: onFailed,
    maxTiles: multiView ? 72 : undefined,
  });
  const canvasFactory = createDomCanvasFactory();
  const sprites = createSpriteStore({ canvasFactory });
  const session = createWorldSession({
    loader,
    canvasFactory,
    rasterBudgetBytes,
    readSprites: () => sprites.current(),
  });
  void sprites.load().then((loaded) => {
    if (!loaded) return;
    session.raster.invalidateRect(WHOLE_WORLD_RECT);
    session.overhead.invalidateRect(WHOLE_WORLD_RECT);
  });
  return session;
}
