"use client";

import { useState } from "react";

/** WebP source for the landscape splash art shown while the map loads. */
export const GAME_SPLASH_WEBP = "/branding/splash-game-landscape.webp";
/** JPEG fallback for the landscape splash art shown while the map loads. */
export const GAME_SPLASH_JPG = "/branding/splash-game-landscape.jpg";
/** ODbL attribution shown on every overlay screen that displays the map. */
export const ATTRIBUTION_TEXT = "Kaart © OpenStreetMap-bijdragers";

/** Props for {@link ArenaLoadingScreen}. */
type ArenaLoadingScreenProps = {
  loaded: number;
  total: number;
  failed: boolean;
};

/** Full-screen loading state: splash artwork, "Kaart laden…" progress and the OpenStreetMap attribution. */
export default function ArenaLoadingScreen({
  loaded,
  total,
  failed,
}: ArenaLoadingScreenProps): React.JSX.Element {
  const [imageBroken, setImageBroken] = useState(false);

  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-0 z-10 flex flex-col bg-[#0B1220]"
    >
      {imageBroken ? null : (
        <picture className="min-h-0 flex-1">
          <source srcSet={GAME_SPLASH_WEBP} type="image/webp" />
          <img
            data-testid="game-splash-image"
            src={GAME_SPLASH_JPG}
            alt=""
            decoding="async"
            className="h-full w-full object-cover object-center"
            onError={() => setImageBroken(true)}
          />
        </picture>
      )}
      <div className="shrink-0 px-4 py-3 text-center text-sm text-[#c9d1d9]">
        <p className="font-semibold">
          Kaart laden… {loaded}/{total}
        </p>
        {failed ? (
          <p className="mt-1 text-[#f0b429]">Kaart kon niet volledig laden</p>
        ) : null}
        <p className="muted mt-2 text-xs">{ATTRIBUTION_TEXT}</p>
      </div>
    </div>
  );
}
