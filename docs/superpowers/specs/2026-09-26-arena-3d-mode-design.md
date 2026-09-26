# GTA H3 — 3D mode, destructible buildings and the rocket launcher

Date: 2026-09-26 · Branch: `feat/arena-3d` · Status: approved by the owner's standing instruction
("build it fully autonomously; where you have questions give your best recommendation and go").

## 1. What the owner asked for

> Build in the option to switch to 3D mode in the GTA H3 game. Make it a full 3D single/multiplayer
> that's enjoyable to play, structures are destructible. In line with the 2D sprites but then the 3D
> version, and you can extend and use imagination where sprites are missing for the 2D world. Rich
> characters, first person shooter variant.

Read as five requirements:

1. **A switch**, not a separate game: the same session can flip between 2D and 3D.
2. **Full 3D, single and multiplayer**: everything the 2D game has — missions, traffic, cops,
   pickups, rooms — works in 3D.
3. **Destructible structures**: buildings take damage and collapse; every player in a room sees the
   same ruins.
4. **In line with the 2D art**: the 3D characters, cars and ground are the 3D versions of the
   existing sprites and textures; where no sprite exists (façades, interiors of streets, landmark
   silhouettes) we invent in the same palette.
5. **Rich characters and a first-person variant**: articulated, animated people, and a camera that
   can sit behind the eyes.

## 2. The decision everything else follows from

**3D is a second renderer over the unchanged 2D simulation.** The simulation stays a pure,
deterministic top-down model in metres (x east, y south). The 3D renderer reads the same `Scene`
the 2D renderer reads and draws it in perspective; the input layer turns the camera's direction back
into the simulation's `move`/`aim` vector.

Consequences, all intended:

- Multiplayer needs no new netcode: host/client loops, prediction, snapshots, rooms and scoreboard
  are untouched. A 3D player and a 2D player can share one room.
- Missions, cops, traffic, pedestrians, pickups and the radio keep working without per-feature ports.
- Heights are presentation. Bullets fly in the plane at chest height; looking up or down moves the
  view, not the shot (§6.3 shows the crosshair honestly for that).

Rejected alternatives: a separate 3D simulation with vertical physics (a rewrite of 17 k lines of sim
and netcode, and 2D/3D players could no longer meet) and a physics engine (Rapier/cannon — a large
WASM dependency for effects the renderer can fake).

## 3. Destructible buildings (simulation — shared by 2D and 3D)

### 3.1 Identity

Buildings are clipped per 2 km tile, so one building can exist as two pieces. A structure id is the
piece's position in its tile: `id = (tileY * STRUCTURE_TILE_STRIDE + tileX) * STRUCTURE_INDEX_STRIDE + index`.
Every client loads the same map version, so ids agree across devices. Damage from one blast reaches
every piece it overlaps, so the two halves of a clipped building fall together in practice.

### 3.2 Health

`maxHealth = clamp(footprintArea × levels × 1.2, 120, 1800)`: a garden shed falls to two rockets or
a burning car; a four-storey block needs a sustained effort. Landmark buildings (churches, the pool,
campus, cafés, the brewery) are **indestructible** — missions anchor on them and they are the map's
orientation points.

### 3.3 Damage sources

| Source           | Structure damage                                    |
| ---------------- | --------------------------------------------------- |
| Bullet (any gun) | 25 % of the bullet's damage to the building it hits |
| Fist / bat       | none                                                |
| Car explosion    | 260 within 6 m                                      |
| Tank shell       | 320 within 5 m                                      |
| Rocket           | 420 within 5 m                                      |

Blast damage falls off linearly to half at the edge of the radius and reaches every structure whose
footprint the blast circle overlaps.

### 3.4 State

`ArenaState.structures?: StructureState[]` where `StructureState = { id, damage, destroyedAtTick }`.
Only damaged structures are listed. Caps: at most `MAX_STRUCTURES` (48) entries; when full, the
least-damaged intact entry is dropped first. Damage heals after `STRUCTURE_HEAL_TICKS` (90 s) without
a hit. A destroyed structure is **rebuilt** after `STRUCTURE_REBUILD_TICKS` (4 min) once nobody
stands inside its footprint — the city never ends up as a wasteland in a long session.

### 3.5 Consequences in the world

A destroyed structure is removed from collision and from bullet ray-casts through a per-tick
**collision view** (`withoutStructures(grid, destroyedIds)`), created once at the top of the step, so
cars drive over rubble, people walk through the gap and bullets pass. Everything inside a building
when it collapses takes 60 damage (people) or 120 (cars). The step emits a `collapse` event
(`{ kind: "collapse"; structureId; x; y; killerId }`) for sound, haptics and the collapse animation.

### 3.6 Wire

Snapshot field `z?: number[][]`, rows `[id, damage, destroyedAtTick | NONE]`, omitted when empty.
48 rows ≈ 1.2 KB worst case, inside the 8 KB snapshot budget. Clients adopt the host's list
wholesale; prediction never changes it.

## 4. The rocket launcher (Raketwerper)

Destruction needs a tool a player on foot can carry. `WeaponKind` gains `"rocket"`: damage 60 on a
direct hit, 0.6 shots/s, 90 m range, **45 m/s** (a visible projectile you can dodge), 4 rockets per
pickup, 12 max. `PickupKind` gains `"rocket"`; one rocket pickup spawns per zone. Key `6` selects it;
it joins the end of the Wapen cycle.

**Explosive projectiles**: the rocket and the tank's shell now detonate — on anything they hit and at
the end of their range — with a blast at the impact point (people: 70 damage within 4 m, cars: 90;
structures per §3.3). Unlike a car explosion, a projectile blast knows its shooter, so kills count for
the scoreboard.

Wire: appended columns only (player row: rocket ammo at index 22; bullet row: weapon index at 7;
the pickup and weapon lists append `rocket`), so an older client still decodes a newer snapshot.

## 5. 2D coherence

A 2D player in the same room must see the same city:

- Destroyed structures draw as a rubble fill (irregular darker patches in the footprint) over the
  cached ground raster; damaged ones are shaded darker by their damage share. Both are a dynamic
  overlay drawn after the chunks, so the raster cache is never invalidated.
- Rockets draw as a small body with a smoke trail; the rocket pickup and held item fall back to a
  vector icon until sprite art exists.

## 6. The 3D renderer

### 6.1 Module layout

`src/lib/cityArena/render3d/` — imported only through a dynamic `import()` the first time 3D is
switched on, so the 2D game's bundle does not grow by three.js.

| File             | Responsibility                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coords.ts`      | world ↔ three mapping (`(x, y)` metres → `(x, height, y)`), angle helpers — pure                                                                                |
| `renderer3d.ts`  | `createRenderer3d(canvas, options)`: WebGL renderer, scene, lights, sky, fog, frame `render(scene3d)` and `dispose()`                                           |
| `cameraRig.ts`   | third-person and first-person rigs, mouse-look yaw/pitch, car chase, death orbit — pure maths + a thin three wrapper                                            |
| `worldCells.ts`  | tile → 128 m cells; lazy build within the view distance under a per-frame time budget; LRU disposal                                                             |
| `buildCell.ts`   | one cell's merged geometry: ground, roads + pavements, water, buildings (extruded walls + roofs), trees and furniture instances                                 |
| `textures.ts`    | loads the existing 2D surface textures as repeating `Texture`s (8 m per repeat), and generates façade textures (brick, plaster, glass; lit windows) on a canvas |
| `characters.ts`  | procedural low-poly humanoid as one rigid-skinned `SkinnedMesh`: 8 looks, walk/run/idle/aim/dead poses, weapon in hand                                          |
| `vehicles.ts`    | procedural vehicle per kind, body colour from `CAR_BODY_COLOURS`, lights, police light bar, wheels, tank turret, wreck look                                     |
| `props.ts`       | pickups (spinning item models over a glow ring), weapons, rubble mounds                                                                                         |
| `effects.ts`     | tracers, rockets with smoke, muzzle flashes, impacts, explosions (fireball + light + smoke + debris), collapse dust, pooled particles                           |
| `entities.ts`    | per-frame sync of pooled meshes from the `Scene`: players, peds, cops, cars, pickups, bullets, effects                                                          |
| `destruction.ts` | structure damage shading, collapse animation, rubble, cosmetic knock-over of street furniture                                                                   |
| `overlay3d.ts`   | on the 2D canvas above: crosshair, hit marker, other players' markers, prompts — pure projection maths                                                          |
| `viewmodel.ts`   | first-person hands + weapon with recoil and sway                                                                                                                |

### 6.2 Canvas stacking

The WebGL canvas sits **under** the existing 2D canvas. In 3D mode the 2D canvas is cleared each
frame and used as the HUD layer (crosshair, feedback vignette, markers); it keeps receiving every
pointer and wheel event, so none of the input bindings move. Split screen and the TV screen stay 2D.

### 6.3 Cameras

- **Third person** (default): over the right shoulder, 3.6 m behind, 1.9 m up, the character turned
  to the aim (strafing). In a car: a chase camera 7–10 m behind (by vehicle length) that eases behind
  the heading when the mouse is idle for 1.2 s.
- **First person**: eye height 1.65 m on foot, driver's seat in a car; the view model shows hands and
  the held weapon.
- **Mouse-look** through pointer lock (click on the playfield to capture; Esc releases, which also
  opens the menu as before). Touch: the aim stick is camera-relative and the camera turns toward it.
- `V` toggles third/first person. Pitch is clamped (−35°…+40° third, −30°…+30° first).
- The crosshair is drawn where the in-plane shot line crosses 25 m ahead, so the reticle tells the
  truth about the flat simulation when the player looks up or down.
- Death: the camera rises and slowly orbits the body while the existing WASTED overlay plays.

### 6.4 Input

`cameraRelativeInput(input, yaw, driving)` — pure, in `input/cameraInput.ts`:

- On foot, keyboard and stick vectors rotate from screen space into the camera's frame
  (W = forward along the camera), and `aim = yaw`.
- In a car the keyboard keeps its tank steering (W gas, A/D steer). The analog stick rotates by the
  camera yaw so "stick up" means "the way the camera looks", matching the chase view.

### 6.5 The world

- **Streaming**: tiles arrive as today; each tile splits into 128 m cells. Cells within the view
  distance (quality: 260 / 380 / 520 m) are built nearest first within 5 ms per frame, and disposed
  beyond 1.4× the distance. Fog hides the edge.
- **Ground**: ground polygons triangulated (`ShapeUtils`) and textured with the existing ground,
  road, pavement and water textures at 8 m per repeat — the same art as 2D, so the city reads the same.
- **Roads**: ribbons along the centre lines at `ROAD_WIDTH_M`, pavements as wider ribbons beneath,
  centre-line markings for the classes 2D draws them on.
- **Buildings**: footprints extruded to `levels × 3.1 m` (min 3.5 m), walls with generated façade
  textures (brick, plaster, concrete; windows lit at random in warm and cold tones), roofs with the
  2D roof textures (tiles for small, gravel for large, exactly the 2D rule) and a pitched hint on
  small houses. Landmarks get dressing: church spire, pool glass hall, campus glass, café awning,
  brewery chimney and copper kettle.
- **Trees**: instanced trunks and layered canopies sized by `TREE_CANOPY_M`, two tones of green.
- **Furniture**: instanced lamps (emissive heads + glow sprite), benches, bus shelters.
- **Lighting**: evening — a sky dome gradient from deep blue to a warm horizon, a moon directional
  light, a hemisphere fill, fog in the horizon colour. Lit windows and lamps are emissive, so the
  scene needs no real point lights beyond a few for explosions and muzzle flashes.

### 6.6 Characters

One procedural rig: pelvis, spine, chest, neck, head, upper/lower arms, hands, upper/lower legs,
feet. The geometry is a merge of boxes/capsule-ish shapes, each vertex bound rigidly to its bone, so
each character is **one draw call**. Looks from the 2D sprites:

| Look          | 3D description                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| player (you)  | bald, warm brown skin, grey goatee, red-lensed sunglasses, shirtless and broad, mint shorts, bare feet, bead bracelet |
| other players | the same build with a coloured vest (per-player hue) so friends are told apart                                        |
| ped1          | navy jacket, red backpack, brown hair, jeans, white sneakers                                                          |
| ped2          | older, grey flat cap, olive coat, brown shoes                                                                         |
| ped3          | yellow raincoat with the hood up, dark trousers                                                                       |
| ped4          | grey hoodie (hood up), black trousers, white sneakers                                                                 |
| ped5          | black suit, white collar, black hair                                                                                  |
| ped6          | blonde ponytail, pink top, black leggings, neon-green sneakers                                                        |
| cop           | Dutch police: navy uniform with neon-yellow bands, cap, holster                                                       |

Poses are procedural: idle breathing, walk and run cycles phased by distance travelled, arms up to
aim a gun or wind up a bat, a death pose lying on the ground. Weapons in hand are small procedural
models (pistol, uzi, shotgun, rifle, bat, rocket launcher).

### 6.7 Vehicles

Procedural low-poly per kind at the simulation's exact dimensions: compact, sedan, sport, police
(white with blue/orange livery and a flashing bar), van, pickup, bus, oldtimer (rounded fenders),
tractor (big rear wheels, green), tank (hull, turret following the driver's aim, barrel). Headlights
and tail lights emissive; wheels spin by speed and the front wheels steer. Wrecks go charred black and
smoke.

### 6.8 Effects and destruction visuals

- Bullets draw as tracers at 1.3 m; rockets as a body with a smoke trail.
- Explosions: expanding fireball, a flash light for 0.2 s, rising smoke, debris chunks with gravity.
- Damaged buildings darken and scorch toward black by their damage share.
- A collapse plays over 1.6 s: the building sinks and tilts, dust billows from the footprint, chunks
  fly; a rubble mound shaped to the footprint remains until the structure is rebuilt.
- Street furniture hit by a car falls over (client-side cosmetic, not simulated).
- Screen shake and the feedback vignette come from the existing feedback state.

## 7. User interface (Dutch)

- Settings sheet: **Weergave** — `2D` / `3D`; **3D-camera** — `Derde persoon` / `Eerste persoon`.
  Stored in `ArenaSettings` (`view`, `camera3d`), default `2d` / `third`.
- A **3D / 2D** toggle button in the HUD strip for discovery.
- In 3D on desktop, before pointer lock: a hint "Klik om te richten · V wisselt camera".
- No WebGL, or the 3D renderer fails: a toast "3D werkt niet op dit apparaat" and the game stays in
  2D; the error goes to Sentry (`area: arena, kind: render3d`).

## 8. Performance budget

- Desktop target 60 fps at "hoog", phones 30 fps at "laag".
- Draw calls: world cells merge per material (≈ 6 per cell); characters and cars are one to five
  each; particles are pooled points.
- Quality maps to pixel ratio (1 / 1.5 / 2), view distance (§6.5) and particle counts.

## 9. Testing

- Unit tests for the pure parts: structure ids, damage/heal/rebuild/caps, blast falloff, collision
  view, explosive projectiles, rocket ammo/pickup, wire round-trip incl. old rows, camera-relative
  input, camera rig maths, crosshair projection, cell partitioning, geometry builders (vertex counts,
  bounds, no NaN), character rig (bone count, bound vertices), vehicle dimensions.
- The existing bot acceptance test keeps proving multiplayer; a new case blows up a building on the
  host and asserts every bot client adopts the ruin.
- Browser check of 3D on the dev server (`npm run dev:preview` launch config), screenshots in the PR.

## 10. Out of scope

Vertical physics (jumping, stairs, rooftops), interiors, a physics engine, destruction persisted
across sessions, 3D on the TV/split screen, VR.
