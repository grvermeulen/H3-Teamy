# GTA H3 visual direction

The city should read as a dark, textured, top-down street game. Keep the map geographically recognizable and reserve contrast for players, navigable roads, threats and pickups. The existing art and palette remain the foundation.

| Element   | Direction                                                                                                                  | Implementation                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Ground    | Muted olive grass, deep teal water, charcoal asphalt; light pavements distinguish routes                                   | `render/palette.ts`, existing terrain textures     |
| Buildings | Warm grey roofs with a consistent lower-right shadow, a lit rim and restrained rooftop detail                              | `render/drawStatic.ts`; painted into cached chunks |
| Landmarks | Church spire/cross, swimming-pool lanes, campus panels and a warm café accent; shape accompanies colour                    | `render/drawStatic.ts`                             |
| Player    | Keep the recognizable character sprite, outline ring and an orientation marker that remains visible with the sprite loaded | `render/drawEntities.ts`                           |
| Vehicles  | Compact short body, sedan sprite, narrower sports body with a wing, police body with a white band                          | `render/drawVehicles.ts`                           |
| People    | Consistent head/shoulder silhouettes and orientation; police additionally have a cap/chevron                               | `render/drawPeople.ts`                             |
| Pickups   | Stable icons: cross for health and distinct bar patterns for ammunition; contrast outline, optional bobbing                | `render/drawPickups.ts`                            |
| HUD       | 64-pixel status bar; primary actions at least 44 pixels; secondary actions in Menu                                         | `CityArenaOverlay.tsx`, `ArenaSettingsSheet.tsx`   |
| Lobby     | A collapsible strip leaves the city playable; reopening restores keyboard focus                                            | `ArenaPhaseScreens.tsx`                            |

Treat screenshots at normal gameplay scale as the review surface. Extra detail must not obscure paths or the player. Render static detail once per cached chunk; do not introduce per-frame roof lighting or unbounded particle work. Automatic/low quality uses smaller raster targets and fewer effects. Reduced motion disables decorative pickup motion, flashing and screen effects where supported.

Current screenshots: [phone](after-phone.png), [landscape](after-landscape.png), [desktop](after-desktop.png). Desktop screenshots with touch buttons deliberately use the selectable phone layout. The captures establish layout and local readability, not colour-vision accessibility certification or physical-phone GPU performance.
