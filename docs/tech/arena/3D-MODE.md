# GTA H3 — 3D mode

## Summary

A second, optional renderer over the unchanged 2D simulation (spec:
`docs/superpowers/specs/2026-09-26-arena-3d-mode-design.md`). The player can switch between a
top-down 2D view and a third- or first-person 3D view of the same match at any time; every other
client keeps seeing whatever mode it is in. Nothing about the simulation, netcode or scoring
differs between the two — 3D is presentation only, built from the same `Scene` the 2D renderer
already draws.

Shipped alongside 3D: networked destructible buildings (sim-side health, collapse and rebuild,
rendered as ruins in both 2D and 3D), a rocket launcher, and 3D-only guidance (navigation ribbon,
mission beacons, player markers, a zone wall). Protocol version is **4**.

## Screenshots

Captured in the dev build (Wageningen, dusk):

|                                                                                   |                                                                                  |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ![First person with the pistol, a rubble field ahead](img/3d/3d-first-person.jpg) | ![Three row houses shot down, rubble mounds in the gap](img/3d/3d-ruins-row.jpg) |
| ![A house collapsing: stand-in, dust and debris](img/3d/3d-collapse-a.jpg)        | ![The same collapse half a second later, sinking](img/3d/3d-collapse-b.jpg)      |

The same ruins in the 2D view: ![2D rubble and damage shading](img/3d/2d-ruins-row.jpg)

First person at the wheel and on foot with the Uzi (see [Cockpit](#cockpit) and
[Shots leave the weapon](#shots-leave-the-weapon)):

|                                                                                                         |                                                                                              |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| ![The sedan's cockpit: wheel in both hands, speedometer, pillars, yellow bonnet](img/3d/3d-cockpit.jpg) | ![An Uzi round streaking from the barrel toward the crosshair](img/3d/3d-muzzle-tracers.jpg) |

## Architecture

### A second renderer, not a replacement

The 2D renderer (`src/lib/cityArena/render/`) keeps running exactly as before; 3D
(`src/lib/cityArena/render3d/`) is an alternative way to draw the same per-frame `Scene` — players,
peds, cops, vehicles, bullets, effects, structures — that `arenaRuntime.ts` builds every frame
regardless of which view is active. Switching modes never touches the simulation, the network
client or the HUD state; it only changes which renderer reads that frame's `Scene`.

### Dynamic import

`src/lib/cityArena/render3d/index.ts` is the 3D view's only public entry point:

> Everything outside `render3d/` and `components/cityArena/view3d/` may import from here with
> `import type` only.

`src/components/cityArena/view3d/useView3d.ts` loads the whole module with one dynamic
`import("@/lib/cityArena/render3d")`, the first time a player switches to 3D — so three.js and
every render3d file stay out of the 2D game's bundle for players who never open 3D. Before that
download it asks a throwaway canvas for a WebGL2 context (`hasWebGl2` in
`src/lib/cityArena/webgl2.ts`, which loses the probe's context straight away), so a device without
WebGL2 never fetches three.js; `createView3d` still throws `WebGl2UnavailableError` if the real
canvas refuses. Either way the hook shows "3D werkt niet op dit apparaat" for 4 seconds and falls
back to 2D, and the failure is a Sentry breadcrumb, not an exception (AGENTS.md's Sentry-noise
policy — no WebGL2 is expected on some devices). The same goes for the render3d chunk failing to
download — a `ChunkLoadError` from a tab still on the previous deploy, or a dropped connection
(`isChunkLoadError` in `src/lib/cityArena/chunkLoadError.ts`). Any other failure while starting or
rendering 3D goes to Sentry as a real error and also falls back to 2D.

When the view is disposed (back to 2D, a new boot, leaving the game) it frees the module-level
geometries and materials that characters, vehicles, pickups and weapons share
(`disposeSharedAssets` in `render3d/sharedAssets.ts`) before the renderer, so toggling 2D↔3D does
not keep old renderers reachable through three.js's dispose listeners; the next view rebuilds them.

### Canvas stacking

The 3D view renders into its own WebGL `<canvas>`, created fresh on every mount
(`mountView3d` in `useView3d.ts`) and stacked **under** the existing 2D canvas inside
`View3dLayer` (`components/cityArena/view3d/View3dLayers.tsx`). In 3D mode the 2D canvas is
cleared every frame and repainted as a transparent HUD layer (crosshair, off-screen friend arrows,
the click-to-aim hint, the failure toast) by `render3d/overlay3d.ts`; it keeps every pointer, wheel
and touch event, so none of the existing 2D input bindings move. The WebGL layer itself has
`pointer-events: none`. Split screen and the TV screen (`/arena/scherm`) stay 2D — see Known
limitations.

### Module map: `src/lib/cityArena/render3d/`

Grouped by responsibility; every exported symbol carries its own JSDoc.

**Entry point, renderer and shared plumbing**

| File              | Responsibility                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `index.ts`        | `createView3d(canvas)`: wires every layer together, places the camera, drives one frame                            |
| `renderer3d.ts`   | WebGL renderer, three.js scene, camera, evening lights, fog; `RenderQuality`, view distance and pixel-ratio tables |
| `cameraRig.ts`    | Third-person and first-person rigs (the driver's eye per vehicle kind), pitch limits, car chase and death orbit    |
| `cameraFeel.ts`   | The 2D feedback's screen shake (`SHAKE_METRES_PER_PX`) and drunk sway, as a camera nudge and roll                  |
| `sharedAssets.ts` | `disposeSharedAssets`: frees the module-level character, vehicle, pickup and weapon caches on dispose              |
| `coords.ts`       | The one world ↔ three.js mapping (`(x, y)` metres → `(x, height, y)`) and angle helpers                            |
| `idHash.ts`       | Deterministic per-id "randomness" (façade choice, tree size/turn) so every device builds the same town             |
| `disposal.ts`     | `disposeObject`: frees geometries, materials and textures of a whole `Object3D` subtree                            |
| `meshBuffers.ts`  | Growable vertex/index buffers the city builders fill, turned into one indexed `BufferGeometry`                     |
| `lowPoly.ts`      | Bevelled/tapered block and faceted-rod primitives, vertex-coloured and flat-shaded                                 |
| `footprint.ts`    | Footprint measurements (centre, longest edge) shared by roofs, landmark dressing and ruins                         |
| `testing/`        | Shared test doubles/helpers for render3d's own test suite                                                          |

**The streamed city**

| File                  | Responsibility                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `city3d.ts`           | Owns the shared `WorldMaterials` and the streamed cells; rebuilds a cell when a landmark lookup changes                                                                    |
| `cellGrid.ts`         | The 128 m cell grid, counted from the world origin                                                                                                                         |
| `worldCells.ts`       | Streams cells around the camera under a time budget, drops far ones, rebuilds a cell when a building in it falls, rebuilds or its tile arrives, scorches damaged buildings |
| `buildCell.ts`        | One cell's merged geometry from the decoded map tiles: ground, roads, buildings, trees, furniture                                                                          |
| `worldMaterials.ts`   | The materials every cell shares (never owned or disposed per cell)                                                                                                         |
| `textures.ts`         | Loads the 2D surface art as repeating textures; paints façade textures (brick/plaster/glass, lit windows) on a canvas from a seed                                          |
| `sky.ts`              | The evening sky dome, fog-matched at the horizon                                                                                                                           |
| `roadMesh.ts`         | Road ribbons, centre-line markings, street lamps along the pavements                                                                                                       |
| `buildingMesh.ts`     | Extruded walls with façade textures; roofs by the 2D map's own tile-vs-gravel rule                                                                                         |
| `pitchedRoof.ts`      | A ridge-and-gable roof for non-rectangular footprints (churches, pools)                                                                                                    |
| `treeMesh.ts`         | Instanced trunks and canopies, two greens                                                                                                                                  |
| `furnitureMesh.ts`    | Instanced lamps/benches/bus shelters with a pose proxy for cosmetic knock-over                                                                                             |
| `landmarkDressing.ts` | Per-landmark silhouettes (church spire, pool glass hall, campus glass, café awning, brewery chimney)                                                                       |

**Characters and vehicles**

| File                                         | Responsibility                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `characters.ts`                              | A posable 3D person: one rigid-skinned mesh, weapon in hand, lies down when dead    |
| `characterRig.ts`                            | The shared 17-bone rig and per-look merged geometry                                 |
| `characterPose.ts`                           | Pure procedural poses: idle, walk/run (phased by distance), aim, death              |
| `characterLooks.ts`                          | The cast's looks, translated from the 2D sprites' sampled colours                   |
| `characterParts.ts`                          | Body/face/hair as rigid low-poly parts bound to one bone each                       |
| `characterExtras.ts`                         | Accessories (shades, caps, hoods, backpack, hi-vis) layered over a look             |
| `vehicles3d.ts`                              | A live vehicle: wheel roll, light bar, tank turret follow, wreck look, over a model |
| `vehicleModels.ts`                           | Procedural low-poly model per vehicle kind, one merged body mesh + wheels           |
| `vehicleParts.ts`                            | Shared material cache and primitive shapes vehicles are cut from                    |
| `vehicleShapes.ts` / `vehicleShapesHeavy.ts` | Per-kind shape builders (passenger kinds; bus/tractor/tank)                         |
| `vehicleSmoke.ts`                            | Wreck column smoke and bonnet smoke below the 2D `smokeHealthOf` threshold          |

**Weapons, view model and projectiles**

| File                  | Responsibility                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `weapons3d.ts`        | Small procedural weapon models, shared between a character's hand and first person                              |
| `viewmodel.ts`        | First-person forearms/fists: stride bob, shot kick, punch/swing, weapon-change dip; the barrel tip in the world |
| `viewModelPass.ts`    | Draws the hands — or, at the wheel, the cockpit — in a pass of its own (near-clipped camera) over the city      |
| `cockpitSpecs.ts`     | `COCKPITS`: every vehicle kind's driver's eye, wheel, dashboard, windscreen, bonnet and frame, in car space     |
| `cockpitParts.ts`     | Pure builders of a kind's cockpit geometry: interior shell, bonnet paint, wheel, dial, glass, siren strips      |
| `cockpit3d.ts`        | A live cockpit: per-kind cached geometry, the wheel turning in both hands, speedometer needle, siren glow       |
| `muzzleMap.ts`        | The frame's muzzle point per shooter id (players, officers, a tank's barrel), pooled                            |
| `muzzleBlend.ts`      | `CONVERGE_M` and the maths that draws a round out of its muzzle onto the flat line                              |
| `projectiles3d.ts`    | Pooled rockets and cannon shells (by bullet id), trails laid by distance flown, launched from the muzzle        |
| `projectileModels.ts` | Shared rocket and shell geometry/materials                                                                      |
| `tracers.ts`          | One shared `LineSegments` draw call for every gun round in flight, drawn out of its shooter's muzzle            |

**Pickups, effects and destruction**

| File                                   | Responsibility                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------- |
| `pickups3d.ts`                         | Spinning/bobbing item models over an additive glow disc, hidden once taken                  |
| `effects3d.ts`                         | Owns the fire/smoke particle budgets and the debris pool; syncs bursts per effect id        |
| `particles.ts` / `particleMaterial.ts` | Pooled `Points` particle systems and their procedural soft-sprite shader                    |
| `debris.ts`                            | Tumbling low-poly chunks in one `InstancedMesh`                                             |
| `fxEmit.ts`                            | Data-driven puff/chunk specs plus seeded emitters                                           |
| `flashes.ts` / `fireballMaterial.ts`   | Muzzle flashes and explosion fireballs, a pooled `PointLight` set                           |
| `glowMaterial.ts`                      | Shared additive glow shader (beacons, pickups, lamp heads)                                  |
| `destruction3d.ts`                     | Collapse stand-in, rubble mounds (`RUBBLE_COLOUR`), furniture knock-over                    |
| `ruinGeometry.ts`                      | Footprint prism and jittered rubble-mound geometry                                          |
| `ruins3d.ts`                           | Finds new collapses by diffing the frame's destroyed-structure ids against the last frame's |
| `knockOver3d.ts`                       | Knocks furniture over near fast cars and fresh explosions                                   |
| `toppling.ts`                          | The generic 90°-tip animation `destruction3d.ts` and `knockOver3d.ts` share                 |

**Guidance, cast and HUD**

| File                 | Responsibility                                                                        |
| -------------------- | ------------------------------------------------------------------------------------- |
| `cast3d.ts`          | One frame step: entity sync, mission contacts, hands or cockpit, effects, destruction |
| `entities.ts`        | Per-frame pooled sync of players/peds/cops/cars/pickups; your car and every muzzle    |
| `entityPool.ts`      | Recycles scene objects per entity id through free lists keyed by look/vehicle variant |
| `entityMotion.ts`    | Infers walk speed, gait phase and wheel turn between frames (pure, allocation-free)   |
| `entityShots.ts`     | Who fired this frame, for character recoil and the view model                         |
| `guidance3d.ts`      | Owns the route, beacons, zone wall and player markers layers                          |
| `route3d.ts`         | The glowing navigation band along the route, rebuilt only when the route changes      |
| `beacons3d.ts`       | Pulsing light columns over mission contacts/objectives, readable from far away        |
| `contacts3d.ts`      | Mission contacts as idle characters in their 2D look                                  |
| `zoneWall3d.ts`      | The match zone's edge as a wall of light, built only near the player                  |
| `playerMarkers3d.ts` | A camera-facing diamond over every other living player                                |
| `playerArrows.ts`    | Edge-of-screen arrows toward friends who are out of view                              |
| `missionMarkers.ts`  | Pure read of the scene's mission contacts/objectives for `guidance3d`/`contacts3d`    |
| `overlay3d.ts`       | The 2D HUD canvas overlay: crosshair and off-screen arrows                            |

## Input

### Camera-relative movement

`src/lib/cityArena/input/cameraInput.ts` (`cameraRelativeInput`) rotates the simulation's raw
`WorldInput.move` into the camera's frame before it reaches the (unchanged) simulation: on foot,
and for an analog stick in a car, "forward" always means "along the camera", while a keyboard
driving a car keeps its tank steering (W gas, A/D steer) untouched. The flat sim's `aim` angle is
replaced by the camera's own look yaw, since 3D gives the player no 2D canvas point to aim at.
`src/lib/cityArena/input/cameraYaw.ts` supplies the camera's own motion besides the mouse: the
third-person chase eases behind the car after `CHASE_IDLE_S` = 1.2 s of a resting mouse, the
driver's seat is bolted to the car and only offset by the mouse, and — with no aim stick held — a
lone movement stick slowly turns the camera toward the walking direction so a touch player without
a second stick can still look around.

### Mouse-look and the lock-free fallback

`src/lib/cityArena/input/mouseLook.ts` (`attachMouseLook`) binds to the 2D canvas: a primary click
requests the browser's pointer lock, and while locked, pointer movement turns yaw/pitch at
`MOUSE_SENSITIVITY_RAD_PER_PX` = 0.0024 rad/px. Pointer lock is refused in some embedded browsers
and sandboxed frames (`requestPointerLock()` rejecting is expected, not a bug) — that refusal is a
Sentry breadcrumb, and mouse-look falls back to **lock-free** mode: plain `pointermove` events over
the canvas turn the camera without any button held, and every click still retries the real lock.
`View3dLayer` shows "Klik om te richten · V wisselt camera" on a fine (mouse) pointer until the
player has either locked the pointer or triggered the lock-free fallback.

When anything modal opens over the playfield — the menu, the map or a mission offer —
`CityArenaOverlay` calls `MouseLook.release()` (through `useReleaseLockWhile` and the view's
`release` control): it exits the pointer lock **without** the lock-lost callback, so the mouse can
reach the dialog's buttons and no pause menu opens over it. The next click on the playfield takes
the lock again. While a mission offer is open the trigger is held off (`holdFireDuringOffer` in
`arenaRuntime.ts`), so a click or pad press meant for "Aannemen" never fires behind it — movement
and the accept command itself still flow.

### V — camera toggle

`KeyV` (`src/lib/cityArena/input/keyboard.ts`, `TOGGLE_CAMERA_KEY`) switches between third and
first person. Pitch is clamped per mode (`pitchLimitsFor` in `cameraRig.ts`): roughly −35°…+40° in
third person, ±30° in first person; `useView3d` re-applies the limits whenever the mode changes.

### Touch

The existing camera-relative touch aim stick pushes the camera yaw the same way a gamepad stick
does (`stickTurnedYaw` in `cameraYaw.ts`); without an aim stick held, the movement stick nudges the
camera as described above. No new touch controls were added for 3D — the existing twin-stick and
single-stick layouts (`docs/tech/arena/README.md`, Plan 6) drive it unchanged.

## Cockpit

In first person at the wheel you look out of the car from the driver's seat (immersion spec
`docs/superpowers/specs/2026-09-27-arena-immersion-design.md` §4):

- **Seat.** `cockpitSpecs.ts` holds one `CockpitSpec` per vehicle kind (`COCKPITS`), in car space
  (+X forward, +Y up, +Z right, origin at the footprint centre on the ground): the driver's eye
  (height, along the car, left of the centre line — Dutch cars put the wheel on the left), the
  wheel (radius, reach, drop, tilt), the dashboard, the windscreen (foot, header, pillars, rake),
  the bonnet (length, width, height, fall to the nose) and where the cab ends behind the eye. The
  numbers are read off the exterior models (`vehicleShapes*.ts`). `cameraRig.ts` seats the
  first-person camera at the kind's eye (`seatOffset`) instead of one fixed seat: a bus or tractor
  driver sits high, a sports car driver low. Mouse-look and the ±30° pitch limit are unchanged.
- **Your car hides for you.** `entities.ts` hides the local player's own car body in first person
  while it is whole (a wreck shows again, and the death camera takes over when you die); everyone
  else keeps seeing it. It also hands the cast the car's kind, paint, steering (the same `trackSteer`
  the front wheels use), speed, pose and siren as `local.vehicle`.
- **Drawn in the view-model pass.** `viewModelPass.ts` draws the cockpit instead of the hands, in the
  same small lit scene seen through a camera that copies the city camera but clips at 1 cm, after
  the city with the depth buffer cleared — so the dashboard never clips into a wall and the car
  never pokes through. The cockpit stands where the car stands (`headingToRotationY(heading)`),
  which lines up with the world because the pass camera sits exactly where the city camera does;
  the pass's far plane is 8 m, past a car's nose.
- **The model** (`cockpitParts.ts`, `cockpit3d.ts`): a dashboard sloping down to the windscreen, a
  lit speedometer whose needle sweeps 240° up to `SPEEDO_MAX_MPS` (40 m/s) by `|forwardSpeed|`, the
  steering wheel (a faceted rim, three spokes, hub and column) turning up to `WHEEL_TURN_RAD`
  (2.1 rad, about 120°) either way — eased after the steering so a keyboard's instant full lock
  does not snap it — with both hands (the view model's arm geometry, skin tone and bead bracelet)
  on its rim at ten to two; the forearms hold back most of the wheel's turn so they keep pointing
  to the elbows. Around it: A-pillars, roof header and lining, door tops and cards, B- and C-pillars,
  the rear-view mirror, a faint additive sheen on the windscreen, and the bonnet running to the nose
  in the car's own paint (`bodyColour(kind, colour)`, glossy like the exterior). The bus has an
  upright screen and no bonnet; the tractor an open frame with its fenders and exhaust stack; the
  tank a hatch with a coaming ring, two vision blocks on the deck ahead, its glacis and two grips
  instead of a wheel. The police car's light bar glows blue then red on the windscreen's top while
  its siren runs.
- **Cost.** Geometry is merged and cached per kind (the paint per kind and colour) and freed with
  the other shared assets (`disposeCockpitAssets` in `disposeSharedAssets`); the cockpit is about
  ten draw calls and allocates nothing per frame.

## Shots leave the weapon

The flat simulation fires every round from its shooter's body along an in-plane line at chest
height (`PERSON_CHEST_HEIGHT_M`). The 3D view now draws each round, rocket and shell out of its
shooter's muzzle instead (immersion spec §5):

- **Muzzles** (`muzzleMap.ts`). After posing the cast, `entities.ts` records every armed player's
  and officer's gun tip (`Character3d.muzzleWorld`) and a tank's barrel end for its driver, keyed by
  the id bullets carry in `ownerId` (players and officers share the simulation's one id counter).
  In first person on foot, `cast3d.ts` overwrites your own with the view model's barrel tip in
  world space: the view-model pass camera stands where the city camera does, so that point lines
  up with the drawn gun. The map is pooled: an owner keeps its vector while seen.
- **Convergence** (`muzzleBlend.ts`). A round is drawn at its point on the flat line plus the
  muzzle's offset from the line's start, and that offset fades out (a smoothstep) over the first
  `CONVERGE_M` = 15 m flown. The round keeps its true speed and direction the whole way — it leaves
  the barrel, then settles onto the line — so it lands exactly where the flat hit-scan hits and the
  crosshair (still drawn on the true line) points. A tracer's tail is the same point 3 m back and
  never reaches behind the muzzle.
- **Rockets and shells** (`projectiles3d.ts`) start at the launcher tube or tank barrel and keep the
  muzzle they left from, so a strafing shooter does not swing a rocket already in flight; their
  smoke trails are laid through the same blend.
- **Flashes** (`effects3d.ts`, `bursts.ts`). A muzzle flash carries no owner, so its flame and light
  go to the nearest shooter's muzzle within `MUZZLE_OWNER_REACH_M` (1.5 m) — your own when the flash
  is yours. In first person your own flame stays with the view model, and the street light now
  comes from the drawn gun.
- A shooter whose muzzle is unknown — out of draw distance, or seated in a car (a drive-by) — is
  drawn exactly as before, from the body.

## Destructible buildings

Sim-side logic lives entirely in `src/lib/cityArena/sim/structures.ts` and is identical for 2D and
3D clients; only the drawing differs.

### Identity and health

`src/lib/cityArena/world/structureId.ts` packs a structure id from the map tile a building piece
sits in plus its position in that tile's building list (`structureIdOf`/`structureTileOf`), so
every device that loaded the same map version agrees on ids without any wire lookup table.
`structureMaxHealth(ring, levels, landmark)` is `area × max(1, levels) × 1.2` (`STRUCTURE_HEALTH_PER_M2_LEVEL`),
clamped to `[120, 1800]` (`MIN_STRUCTURE_HEALTH`…`MAX_STRUCTURE_HEALTH`); a landmark's health is
`Infinity` — landmarks never fall, since missions anchor on them. `ArenaState.structures` is
sparse: a building nobody has hit has no entry and is implicitly at full health, capped at
`MAX_STRUCTURES` = 48 tracked entries (the least-damaged intact one is dropped first).

### Damage sources

| Source                      | Amount                                                     | Radius                  | Falloff                                                                             |
| --------------------------- | ---------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------- |
| A bullet hit                | `BULLET_STRUCTURE_FACTOR` (0.25) × the bullet's own damage | — (direct hit)          | —                                                                                   |
| Car explosion (`CAR_BLAST`) | 260 at the blast centre                                    | 6 m (`structureRadius`) | Yes, on structures only — the same blast's damage to people/cars near it stays flat |
| Tank cannon shell           | 320 at the blast centre                                    | 5 m                     | Yes                                                                                 |
| Rocket                      | 420 at the blast centre                                    | 5 m                     | Yes                                                                                 |

A building's accumulated `damage` heals away after `STRUCTURE_HEAL_TICKS` = 2700 ticks (90 s)
without a hit, once it is still standing.

### Collapse and rebuild

Once accumulated damage reaches a structure's max health, `damageStructure` marks it destroyed at
the current tick and crushes everyone and everything still in or within `CRUSH_MARGIN_M` (1.5 m)
of its footprint — 60 damage to a person on foot or a pedestrian/cop, 120 to a car — and pushes one
`collapse` event plus a `kill` event per victim it finishes off. A destroyed structure rebuilds
(`stepStructures`) once `STRUCTURE_REBUILD_TICKS` = 7200 ticks (4 minutes) have passed **and**
nobody living still stands in its footprint; the timer alone does not rebuild an occupied ruin.

### On the wire (protocol 4)

`ARENA_PROTOCOL_VERSION` (`net/roomProtocol.ts`) is **4**. The snapshot's `z` field
(`encodeStructures`/`decodeStructures` in `net/snapshotWire.ts`) carries one row per non-default
structure — `[id, damage, destroyedAtTick | NONE, lastHitTick]` — and is omitted entirely when no
structure has ever been hit, so an untouched city costs nothing on the wire. Older protocol-3 rows
are rejected outright by the version bump rather than silently misread, since the rocket weapon and
its pickup also widened the wire's weapon/pickup-kind lists in the same release.

### Client-side explosion and collapse feedback

Events and effects never cross the wire, so a non-host client would see a rocket or shell vanish
without a fireball, a car wreck without a blast, and a building fall (the 3D collapse plays from the
structure list) without a sound, a shake or a pulse. `net/clientFeedback.ts` makes those up on the
client alone: the client loop folds every adopted snapshot through `createFeedbackQueue`, which
compares it with the previous one and adds

- an `explosion` event and effect where an explosive round (`isExplosive`: rocket, cannon) was in
  the previous snapshot and is gone from this one, at its last known position, and where a car was
  intact and is now wrecked (at the car blast's 3 m);
- a `collapse` event for every structure newly destroyed in `z`, at its own footprint centre when
  the client knew it, else at the footprint the collision grid holds within
  `COLLAPSE_LOCATE_RADIUS_M` (60 m, the farthest a collapse is felt or shakes the screen) of the
  player.

The events ride on the next predicted tick's `onTick` state, so sound, haptics and shake treat them
like the host's. The made-up effects take ids counting down from `FIRST_CLIENT_EFFECT_ID` (−1): host
entity ids are never negative, so they cannot collide, and the 3D view bursts each id once. The
first snapshot a loop adopts is never compared (the world before it was the client's own), and
`predictLocal` expires effects as the host step does. The host and offline play never run this, so
nobody hears a blast twice. A round first seen on the wire gets its weapon's speed and a range left
estimated from its distance to its shooter, so other players' 3D tracers have a tail.

### Client prediction through ruins

`net/predictLocal.ts` builds its local-movement collision grid with
`withoutStructures(collision, destroyedStructureIds(state))` — exactly the helper the host
simulation itself uses (`sim/arena.ts`) — so a non-host client's predicted movement passes through
a collapsed building's footprint the same tick the host's does. Without this, a player would
rubber-band against a ruin's invisible old walls until the next authoritative snapshot arrived.

### Drawing ruins in 2D and 3D

Both renderers read the same sparse `structures` list; neither receives the simulation's
`collapse` event directly (it never crosses the wire — see `ruins3d.ts`'s module comment). In 3D,
`ruins3d.ts` compares each frame's destroyed ids against the previous frame's: an id destroyed
within the last `RECENT_COLLAPSE_S` = 2 seconds plays the fall (`destruction3d.ts`'s sinking,
tilting, dust and debris prism), while an older or newly-loaded ruin simply appears as a finished
rubble mound — the same distinction a player would see switching to 3D mid-match or walking into
range of an old ruin for the first time. `worldCells.ts` rebuilds the affected city cell when a
building in it collapses or rebuilds, and re-applies any furniture already knocked over across
that rebuild.

## Rocket launcher

**Raketwerper** (`WeaponKind: "rocket"`, key **6**, last in `WEAPON_ORDER`/the weapon-select
cycle): 60 direct damage, 0.6 shots/s (50-tick cooldown), 90 m range, 45 m/s projectile speed, a
4-round magazine and 12 rounds max carried. It is a magazine weapon like the Uzi/shotgun/rifle/bat.
Its blast (`EXPLOSIVES.rocket`) is what actually damages buildings and nearby entities: 420
structure damage and 70 entity/90 vehicle damage within a 5 m radius, with falloff. One rocket
pickup spot exists per zone (`ROCKET_PICKUPS_PER_ZONE` in `sim/pickups.ts`), placed after the bat
spots, and grants 4 rounds (`PICKUP_ROUNDS.rocket`). The tank's cannon shell uses the same
`EXPLOSIVES` blast shape and also damages buildings (320 structure damage, 5 m radius) — see the
damage sources table above.

## Performance notes

- **View distance by quality** (`renderer3d.ts`, `VIEW_DISTANCE_M`): 260 m at "laag", 380 m at
  "auto" (dropping to 260 m on a phone-width viewport, matching the 2D view's own render-scale
  rule), 520 m at "hoog". Fog closes exactly at the view distance; cells are kept resident out to
  1.4× that distance (`KEEP_DISTANCE_FACTOR`) before disposal, to avoid rebuilding a cell the
  camera is only briefly outside.
- **Device pixel ratio cap** (`MAX_PIXEL_RATIO`): 1 at "laag", 1.5 at "auto", 2 at "hoog".
- **Cell build budget**: `WORLD_BUILD_BUDGET_MS` = 4 ms per frame for streaming in new/rebuilt
  city cells, nearest first; a cell whose build would exceed the budget waits for a later frame.
- **Particle budget by quality** (`cast3d.ts`, `EFFECT_PARTICLES`): 600 (laag) / 1200 (auto) / 1600
  (hoog) particles alive at once across fire and smoke together, set once by the first frame's
  quality and shared with the destruction system's dust.
- **Draw calls**: roughly 15–25 per dense city cell (190–290 across a typical view), 8–10 per
  vehicle, and characters/pickups/weapons each merge to one or two draw calls via shared,
  vertex-coloured, per-look/per-kind geometry. The first-person cockpit adds about ten (interior,
  bonnet, glass, wheel, two hands, dial, needle, and the police car's two siren strips) while your
  own car's eight to ten are hidden.

## Known limitations

- **Bullets stay in the simulation's flat plane.** The 2D simulation has no concept of height, so a
  bullet's vertical position in 3D is presentation only: rounds are drawn from their shooter's
  muzzle and converge onto the in-plane line at chest height within 15 m (`CONVERGE_M`); aiming up
  or down changes where the 3D camera looks, not what the flat hit-scan can actually hit. The
  crosshair is deliberately drawn on the true in-plane shot line so it never lies about this.
- **Drive-by shots start at the car's centre.** A player seated in a car has no drawn body, so
  shots fired from the driver's seat (and a wrecked tank's) are drawn from the chest-height line as
  before; only a tank's cannon starts at its barrel end.
- **The cockpit's siren glow shows only for a police-driven car.** The simulation turns a police
  car's lights on only while the police AI drives it (`policeCarIds`), so a player at the wheel of a
  stolen police car sees no glow on the windscreen — as the car's own light bar stays dark for
  everyone else. The glow is wired to the same flag and lights up if that ever changes.
- **The tank cockpit has no barrel or turret.** Your whole tank hides in first person; the hatch view
  shows the deck, glacis and vision blocks ahead, not the turret or the barrel turning with the aim.
- **A remote tank's turret always faces forward.** Turret aim is not on the wire — only the
  driver's own client knows where their mouse points — so `vehicles3d.ts`'s `aimTurret` points a
  tank's turret straight ahead for everyone except the player actually driving it.
- **3D is not available on the TV screen or split screen.** `/arena/scherm` and multi-player split
  screen keep rendering 2D only; `useView3d`/`View3dLayer` are wired into the single-player overlay
  (`CityArenaOverlay.tsx`/`useArenaGame.ts`) alone.
- **Mission boarding passengers are not drawn in 3D.** A scripted mission passenger who boards a
  vehicle is a 2D-only visual; the 3D cast does not yet seat one in the car model.
- **The structure cap has an edge.** At most `MAX_STRUCTURES` = 48 structures are tracked. When the
  list is full, the least-damaged standing entry is dropped first — which can be the building just
  hit, so fresh damage may be lost; once all 48 are ruins, the oldest ruin is dropped and so stands
  up again early.
- **A ruin never rebuilds while someone stands in it.** The 4-minute rebuild waits for its footprint
  to be empty of living players, pedestrians, cops and cars; a car parked in the rubble keeps it a
  ruin for as long as it stays.
- **After a host handover, adopted ruins carry radius 0 until rebuilt.** Footprint centre and
  radius are not on the wire, so a client that becomes host holds rows it only adopted with
  `radius` 0: the occupancy check skips them (they rebuild on the timer alone) until they are
  rebuilt and re-enter with their real footprint.
- **Traffic can pop in beyond 80 m.** In 3D the simulation's out-of-sight rect is a square
  `VIEW3D_POPULATION_HALF_M` = 80 m each way around the player, while the fog closes at 260–520 m,
  so cars and pedestrians may visibly spawn or despawn between 80 m and the fog.
- **Phones at "laag" still need a smoke test.** A dense view draws roughly 190–290 calls (see
  Performance notes), above spec §8's budget; 30 fps on a mid-range phone at "laag" is unverified
  on real hardware.
- **Made-up client feedback is approximate.** A client's fireball sits where the rocket or shell
  was last seen, up to one snapshot interval (about 4.5 m for a rocket, 9 m for a shell) short of
  where it burst; a projectile fired and burst between two snapshots is never seen, so it makes no
  blast on other clients; a collapse the client can place neither by its own footprint nor within
  60 m of its player makes no sound there. The 3D fireball keeps one size; only the 2D ring grows
  to the blast's reach (4 m for a rocket or shell, 3 m for a car).
