# Arena (GTA H3)

## Summary

Top-down multiplayer arena game on the real map of Rhenen, Wageningen and Bennekom.
This document covers the **map pipeline** (PR 1). Gameplay, netcode and persistence are
documented as their PRs land. Design: `docs/superpowers/specs/2026-09-03-city-arena-design.md`.

## Entry Points

- Build script: `scripts/arena/build-map.ts` (`npm run arena:build-map`, `npm run arena:build-map:check`)
- Pure pipeline: `src/lib/cityArena/mapBuild/**` (type-checked, unit-tested)
- Shared runtime types: `src/lib/cityArena/world/mapTypes.ts`, `src/lib/cityArena/world/projection.ts`
- Asset: `public/arena/map/<MAP_VERSION>/` (`index.json`, `roads.json`, `tile_x_y.json`), served with
  `Cache-Control: public, max-age=31536000, immutable` (see `next.config.js`)

## Data Model

- `index.json` — bounds, tile grid, four zones (centre/radius/spawn nodes/landmark keys), landmarks.
- `roads.json` — drivable road graph: flat node coordinates, edges with stride 6
  (`a, b, classIndex, nameIndex, oneway, lengthUnits`), class and name lookup tables.
- `tile_x_y.json` — roads (`points` centre line, `roadClass`, optional `name`), buildings (`points`
  outer ring, `levels`, optional `landmark`), ground (`points`, `kind`: `grass|field|forest`), water
  (`points`). Coordinates are integers in 0.25 m units; north is negative y.
- Source: OpenStreetMap via Overpass, licence ODbL. The asset is a derived database; the app shows
  "Kaart © OpenStreetMap-bijdragers".

## Runbook

1. `npm run arena:build-map` — downloads (cached in `.cache/arena/`, git-ignored), assembles and
   writes the asset. Takes a few minutes the first time; Overpass may answer 429/504 and is retried.
2. Landmark errors — the build prints `Landmark "<key>": N candidates …` with `way/…` ids and names.
   Pick the right one and add `osmId: "way/<id>"` to that entry in
   `src/lib/cityArena/mapBuild/landmarks.config.ts`, then rebuild. Zero candidates means the OSM
   name or tags differ from the config: search the cached landmark response for the name.
3. Budget errors — two independent caps, both in `scripts/arena/buildMap.ts`: total gzipped
   size ≤ 4 MB (`GZIP_BUDGET_BYTES`, "Asset exceeds gzip budget") and no single tile above
   512 KB gzipped (`TILE_GZIP_BUDGET_BYTES`, "Tile(s) exceed the ... per-tile gzip cap" — the
   build lists the offending tiles by name and size). Either one fails the build. Owner decision
   2026-09-07: these are runaway-build guardrails, not a design constraint — the map may grow to
   whatever the world needs, so raise the ceiling before thinning the map. If the map must be
   thinned anyway, the levers are all in `src/lib/cityArena/mapBuild/assemble.ts`: raise
   `MIN_BUILDING_AREA_M2` (drops small buildings) or lower `BUILDING_KEEP_RADIUS_M` (drops
   buildings far from a zone centre) — buildings are the larger contributor to tile size in the
   shipped build (measured per-layer gzip split, spec §3.4), not ground, so these two levers
   matter most; raising `TERRAIN_SIMPLIFY_TOLERANCE_M` (coarser ground/water polygons) helps
   less. Record the change in the spec.
4. Regenerating a shipped map — bump `MAP_VERSION` in `src/lib/cityArena/constants.ts`, build into the
   new folder, delete the old folder in the same PR.
5. `npm run arena:build-map:check` — validates and reports sizes without writing (used by the nightly
   map-freshness job planned for PR 7).

## Testing

- Unit tests co-located under `src/lib/cityArena/mapBuild/` and `scripts/arena/` run in the normal
  `vitest` suite; the network is never touched (injected `fetchImpl`, synthetic fixture
  `fixtures/overpassMini.ts`).

## Licence

The asset is a derived database of OpenStreetMap data © OpenStreetMap contributors, ODbL 1.0
(https://www.openstreetmap.org/copyright).

## Runtime (PR 2 — free-roam)

- Feature toggle: hidden by default behind the admin-controlled `gtaH3Launcher` flag
  (`src/lib/featureFlags.ts`, toggled at `/admin` — see `docs/tech/admin/README.md`). `src/app/page.tsx`
  reads it server-side and passes `gtaH3Enabled` to `EventList`, which renders the launcher card only
  when true.
- Launcher: `src/components/cityArena/CityArenaLauncher.tsx` (card under Space Invaders in `EventList`), overlay
  `CityArenaOverlay.tsx` (dynamic import), loop/HUD state in `useArenaGame.ts`.
- World: `src/lib/cityArena/world/` — `mapLoader` streams the 3 × 3 tiles around the player (≤ 9 resident),
  `worldSession` keeps `collisionGrid` (16 m cells, circle push-out) and the `render/staticRaster` chunk cache
  (128 m chunks, ≤ 40 MB) in sync; `roadGraph` decodes `roads.json` with A\* (used by the debug overlay now,
  by cops in PR 4); `zone` resolves discs and spawn nodes.
- Rendering: `render/renderScene` draws one viewport (chunk blits → zone ring → player); chunks are painted by
  `render/drawStatic` (ground → water → pavements → roads → centre lines → buildings → street/landmark labels).
- Input: WASD/arrows (`input/keyboard`), floating stick on coarse pointers (`input/touchStick` + `TouchStick`).
- Debug: open the overlay with `?debug=1` in the URL (non-production builds) for fps/p95, chunk and tile counts,
  camera/player positions and the route length to the nearest landmark.
- Settings: `localStorage["h3-arena-settings-v1"]` (`lastZone`).

## Runtime (PR 3 — cars, weapons, death screen)

- Simulation: `src/lib/cityArena/sim/arena.ts` — `createArenaState(setup, random)` and one pure fixed-step
  `stepArena(state, input, dt, world, random)` (30 Hz, immutable `ArenaState`, seeded RNG injected, no DOM). Entity
  modules: `weapons` (spec §5 table + fist), `vehicle` (arcade physics, two-circle building collision), `bullets`
  (swept segments via `world/raycast`), `collisions` (car–car, car–player), `damage`, `effects`, `spawn` (8 parked
  cars per zone on spawn nodes, respawn node choice), `invariants` (`checkInvariants(state): string[]`).
- Rules: health 100, no regen; death → respawn after 90 ticks with a 60-tick blinking shield; Instappen within 1.5 m
  with a 0.6 s boarding delay; car health 100, smoke < 40, explosion at 0 (3 m, 80 damage, kills the occupant);
  the spawn loadout is pistol + Uzi 60 + shotgun 8 + fist until pickups arrive (Plan 4b).
- Input: `WorldInput = { move, aim: angle | null, fire, enter, weaponNext }`; keyboard WASD/arrows, Space, E/F/Enter, Q
  (`input/keyboard`), mouse aim + left button (`input/pointerAim`), floating stick + Schieten/Instappen/Wapen buttons on
  coarse pointers (`ArenaTouchButtons`). Enter/exit and weapon-next are edge-triggered inside the simulation.
- Rendering: `render/renderScene` draws world → zone ring → cars (`drawVehicles`) → bullets and effects
  (`drawProjectiles`) → player (`playerLook`: normal/dead/hidden/blink) → crosshair, with a `pushIn` transform for the
  death screen. `render/deathScreen.ts` is the pure beat function (slow-mo 0–0.3 s, slam at 0.3 s, fade 2.6–3.0 s);
  `components/cityArena/DeathOverlay.tsx` shows `public/branding/wasted-screen.{webp,jpg}`.
- HUD: `ArenaVitals` (health `<progress>`, weapon + ammo, km/u while driving) inside the HUD bar, refreshed at 10 Hz.
- Debug: `?debug=1` adds an entity/violation line to the panel and installs `window.__arena`
  (`getState()`, `dispatch(input, ticks)`, `damage(amount)`, `getViolations()`); invariant violations are also sent to
  Sentry as warnings (`kind: "invariant"`), once per distinct message per session.

## Runtime (PR 4 — pedestrians, cops, pickups and audio)

- Active-zone population is bounded by the simulation caps: 25 living pedestrians per zone (40
  pedestrians including bodies), 6–10 ambient traffic cars per zone, at most 12 AI drivers, 8 cops
  including bodies, 140 vehicles and 10 pickups. Pedestrians use pavement rails and flee nearby
  gunfire/explosions; traffic uses the road graph and is kept outside the current camera view when
  it spawns. Pickups are placed near landmarks and zone spawn nodes (6 weapon and 4 health pickups),
  stay at least 15 m apart and respawn after 600 ticks (20 seconds). The pistol and fist are the
  initial loadout; Uzi and shotgun ammunition comes from pickups.
- Wanted heat: a pedestrian kill adds 30, a cop kill 60, firing within 15 m of a living cop 10 and
  ramming a police car 20 heat. Heat converts to up to three wanted stars at 40 heat per level,
  starts decaying by 5 per second after 8 quiet seconds, and is cleared on player death. Foot cops
  are 2 at one star, 2 more at two stars and 4 at three stars; they spawn 60–120 m away, repath
  every 30 ticks and switch to shotguns at three stars. Police cars are added at two stars (one)
  and three stars (two), pursue at 18 m/s and are towed when driverless, out of view and more than
  150 m from every player. Police vehicles use the normal traffic/vehicle caps.
- The 500 m-style zone rule is represented by each active map zone's configured disc. With
  `zoneEnforced` enabled, leaving the selected `enforcedZoneKey` starts a 5-second warning and then
  deals 10 damage per second; free roam keeps the seam disabled. The HUD shows the Dutch countdown
  and wanted stars.
- Radar: `ArenaRadar` draws a 90 px north-up radar covering 150 m, with roads, the zone ring, the
  player, pickups and police. Its canvas has the accessible label `Radar`; the warning and sound
  checkbox are Dutch and remain keyboard reachable. The radar remains on screen during the death
  overlay.
- Sound: `localStorage["h3-arena-settings-v1"]` stores `{ "lastZone": "...", "sound": true }`;
  sound defaults to enabled. `src/lib/cityArena/audio/sound.ts` uses Web Audio for shots,
  explosions, pickups, impacts and engine pitch, resumes on user input, and safely no-ops when Web
  Audio is unavailable. The runtime owns one sound object and disposes it before the world session.
- Debug: `?debug=1` extends the panel with pedestrians, cops, traffic, pickups, wanted level, zone
  seconds and event count. The test-only `window.__arena` seam additionally exposes
  `setZoneEnforced(boolean)` and `addHeat(number)`; it remains unavailable without the debug flag.
- Verification: `npx tsc --noEmit`, `npm run lint`, and `npx vitest run src/components/cityArena
src/lib/cityArena`. The arena tests use fake map/audio/canvas inputs and do not require external
  services. The existing lint warnings in `EventList.tsx` and `src/types/ical.d.ts` are unrelated.

## Runtime (PR 5 — bridges, steering and pace)

- Bridges: the map asset never captured OSM `bridge`/`layer` tags, so a road over water was
  blocked by the water beneath it (66 road edges on the shipped map, e.g. `Nudestraat` and
  `Duivendaal` in Wageningen). `world/roadCorridor.ts` builds a whole-map index of road corridors
  from the decoded road graph — one segment per edge, half-width `ROAD_WIDTH_M[class] / 2 + 2 m`
  (the pavements), bucketed into the collision grid's 16 m cells — and `worldSession.ready()`
  installs it on the grid. `resolveCircle` then skips a `kind: "water"` obstacle while the circle's
  centre is on a road, per circle, so both car hull circles are handled independently. Buildings
  are never exempt and water away from a road still blocks, so swimming stays impossible; beside a
  quay road a walker can wade about 2 m before the water pushes them back.
- Car steering: `input/touchStick.ts` adds a per-axis dead zone (`STICK_AXIS_DEAD_ZONE = 0.2`) so a
  thumb held forward reports no sideways component, and `InputState.snapshot()` reports
  `moveIsAnalog`. `sim/driveInput.ts` maps the movement input onto car controls: keyboards keep
  tank steering, an analog stick is heading-seeking (the steer command is the signed heading error
  over `ANALOG_STEER_FULL_ERROR_RAD = π/4`), pointing the stick more than 135° behind the car
  brakes and reverses toward it, and the command may move only
  `STEER_COMMAND_RATE_PER_S = 6` per second (0.2 per tick). The wheel position lives on
  `ArenaPlayerState.driveSteer` and resets to 0 on entering and leaving a car. `sim/vehicle.ts`
  adds a grip floor: `grip = 0.45 + 0.55 · min(1, v/6)` above 0.5 m/s and 0 below it, so a rolling
  car answers immediately (turn rate at 3 m/s: 1.738 rad/s against 1.211 before) while a parked one
  never pivots and fast cornering is unchanged.
- Pace: `WALK_SPEED_MPS` is 5.5 (was the spec's 4), reached through a `WALK_RAMP_S = 0.15 s`
  acceleration ramp; slowing down stays instant, and the previous speed is clamped to the walk
  speed first so stepping out of a fast car cannot lurch. `COP_RUN_SPEED_MPS` rises to 6 so foot
  cops keep their 0.5 m/s edge. Pedestrians already fled at `PED_FLEE_SPEED_MPS = 5.5`, so matching
  the walk speed to it means a fleeing pedestrian no longer outruns a chasing player.
- Camera: `ZOOM_LEVELS` is `[4, 6, 8, 10, 12]` px/m and phones target ≈ 45 m across (a 390 px phone
  now picks 8 px/m and shows 48.75 m; a 1400 px desktop picks 12 and shows 116.7 m). While moving,
  `speedZoomLevel` drops one step at 12 m/s and returns at 9 m/s — a hysteresis band walking never
  reaches. `arenaRuntime.nextCamera` is the pure helper the frame loop calls.
- Raster budget: chunk bytes are `(128 · zoom)² · 4`, so 9 MiB at 12 px/m. Two zoom levels are live
  while driving, so `RASTER_WORKING_SET_HEADROOM` is 2.5 (was 1.5) with a
  `RASTER_BUDGET_MAX_BYTES = 96 MiB` ceiling that is never applied below one raw working set. A
  390 × 844 phone still lands on the 40 MiB floor and needs ≈ 30 MiB for both zoom sets.
- Verification: `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`. The arena
  tests use fake map/audio/canvas inputs and need no external services. The two existing lint
  warnings in `EventList.tsx` and `src/types/ical.d.ts` are unrelated.

## Sprite art (PR 6 — ground and water textures)

- Palette: the map reads as a game, not a paper map. Owner decision 2026-09-06, after judging the
  first generated tarmac in the running game: the whole palette is keyed to dark asphalt
  (`ROAD_FILL` `#383836`, urban ground `#1e2024`) rather than the light off-white it shipped with.
- Source art lives in `assets/arena/sprites/` at 1024 px; `scripts/generate-arena-sprites.js`
  (`npm run arena:build-sprites`, also part of `prebuild`) packs it into `public/arena/sprites/`
  with `manifest.json`. Nothing in the renderer hard-codes a pixel size — the manifest states each
  asset in metres.
- Textures are authored per real-world size: one repeat covers `TEXTURE_TILE_METRES` = 8 m and
  ships at `TEXTURE_TILE_PX` = 128 px, i.e. 16 px/m, twice the highest camera zoom. Seven seamless
  surfaces ship: `road`, `pavement`, `water`, and one per `GroundKind` (`grass`, `field`, `forest`,
  `urban`). The car sprite is packed separately onto the hull the simulation collides with
  (4.2 × 1.8 m at 32 px/m) with its alpha rebuilt, because the generator leaves the bodywork
  half-transparent.
- The player is the man from the game's splash artwork — bald, red-lensed sunglasses, mint-green
  shorts — drawn from directly overhead, as an eight-frame walk strip. `packPersonSprite` trims
  him onto the box around his collision circle (2 × `PLAYER_RADIUS_M`, 64 px/m, so 51 px per cell)
  and, from a single still, synthesises the cycle: the body rolls ±5° once per cycle and bobs 2 px
  twice, one rise per step. Two attempts at generating a real cycle re-framed and cropped his legs
  frame to frame, which reads as a wobble at the size he is drawn. `walkFrame` holds each cell for
  4 ticks and rests on cell 0 below 0.2 m/s, so he never moon-walks on the spot. `drawPlayer`
  turns the art _minus_ a quarter-turn past the player's facing — his art faces down its own
  image, unlike the nose-up car, and the positive turn had him looking half a turn away from the
  crosshair. On screen it
  is drawn `PLAYER_SPRITE_SCALE` = 1.6 × the circle: the hull hits the 6 px floor at every zoom
  the arena offers, and 12 px is too small to recognise a character in. The colour circle stays
  underneath so he is findable when zoomed out; a body waiting to respawn keeps the flat dead
  marker, because the art is of someone standing up.
- Adding a surface is one line in `surfaceSources` plus the matching key in
  `SpriteManifestSchema.surfaces`; the loader and the painters read those names. A character is
  the same, in `personSources` and `SpriteManifestSchema.people`.
- Rendering: `render/sprites.ts` `surfaceFill()` turns a texture into a `CanvasPattern` whose
  matrix scales pixels onto metres, so the repeat is anchored to the world origin and neighbouring
  chunks line up at their shared edge. `drawStatic.paintChunk` builds one fill per ground kind
  once per chunk (`groundFills`), then paints the chunk background, ground polygons, water,
  pavements and road surfaces with them. Buildings, centre lines and labels stay flat colour.
- Every texture falls back on its own: `loadSprites.ts` reports a failed image to Sentry
  (`kind: "sprite"`) and leaves that one surface on its flat palette colour, so losing the art
  never takes the game down.
- Generation: SpriteCook (`mode: "texture"`, `gpt-image-2`, 1024 px, `bg_mode: "include"`,
  `smart_crop: false`). Prompts state the 8 × 8 m footprint, demand flat orthographic lighting with
  no shadows or gradient, forbid objects and text, and require the edges to continue into each
  other — the seam is what makes the pattern usable.

## Runtime (PR 7 — the simulation carries several players)

Plan 3a widened the simulation from one player to N so the netcode in Plan 3b can run it as a
host loop. No network code exists yet; offline play still has exactly one player and behaves
exactly as it did.

- **State.** `ArenaState.players` is an array in join order, replacing the single `player`.
  Everything that reads it goes through the seam in `sim/players.ts` — `playersOf`, `playerById`,
  `replacePlayer`, `driverPlayer`, `orderedPlayers`, and `localPlayer` for the one this client
  drives. Plan 4 left that module behind for exactly this, so the nine sim modules already using
  it needed no shape change.
- **Buttons.** `HeldButtons` moved from the state onto each player: with one set for the world,
  one player holding Enter swallowed another player's press.
- **Inputs.** `stepArena(state, inputs, dt, world, random)` takes `ArenaInputs`, a
  `ReadonlyMap<playerId, WorldInput>`. A player with no entry is stepped with `EMPTY_INPUT`,
  because a hosted match drops packets and a silent client must not freeze the tick. The step
  runs in three passes: per-player buttons, respawn, weapon and boarding; then one vehicle step
  for the whole world; then per-player firing. Movement sits between them because cars step once
  for everyone.
- **Cars.** `stepVehicles` takes one map of controls keyed by vehicle id. A driving player's
  commands override that car's AI driver, which removed the old special case for "the player's
  car" and lets two players in two cars steer independently.
- **Ordering.** Per-player stages iterate `orderedPlayers` (ascending id), so a tick never
  depends on the order people joined in. `wantedTarget` breaks equal heat on the lower id for the
  same reason: the host and a client replaying the same inputs must chase the same player.
- **Population.** `populationAnchorZone` pins NPCs to the enforced match zone while the zone rule
  is on (spec §6.4), and follows the lowest-id living player in free roam. Clearing a zone keeps
  every car with a player at the wheel, not just this client's, and respawn uses the zone the
  dying player was actually in.
- **Join and leave.** `addArenaPlayer` spawns a joiner on a spawn node of the anchor zone clear of
  cars and pickups, taking the next free entity id so a rejoining client never collides with a
  live entity; it refuses the ninth (`MAX_ARENA_PLAYERS = 8`, spec §6.7). `removeArenaPlayer`
  drops the player and leaves their car standing.
- **Rendering.** `Scene` carries `players` and `localPlayerId`. Everyone is drawn with the same
  character art and walk cycle; remote players get a sky ring instead of your crimson, and your
  own is painted last so nobody standing on you can hide you. The radar stays centred on you and
  plots nobody else — that is a Plan 3b feature, when there are remote players to plot.
- **Acceptance** (replacing the four-player session the owner descoped on 2026-09-07):
  `sim/multiplayer.test.ts` runs 600 ticks of two scripted players with `checkInvariants` on every
  tick and replays the whole match to prove determinism. The invariant checker itself now covers
  every player and adds two rules that only bite with more than one — no shared ids, and no two
  players driving the same car.
- **Known debt.** `sim/arena.ts` is ~950 lines against the spec's 400-line target. It was already
  780 before this work; lifting the per-player half into `playerStep.ts` means moving the shared
  helpers too or accepting a cycle, so it is its own task rather than a rider on a behaviour
  change.

## Runtime (Plan 6 — sound, feel and controls)

Plan 6 makes the arena _feel_ like a game without touching the simulation: recorded sound in
front of the synthesiser, haptics, damage feedback, the twin-stick touch layout the spec designed,
the settings that switch each of them off, and the rest of the keyboard map.

- **Sound.** `audio/clips.ts` is the clip table: eleven `ClipName`s (`pistol`, `uzi`, `shotgun`,
  `footstep`, `engine`, `skid`, `impact`, `explosion`, `siren`, `pickup`, `death`), each with a
  file name under `public/arena/audio/`, a gain and whether it loops (`siren` is an American-style
  wail since 2026-09-10, the owner's call over the European two-tone; `generate-audio.ts` now
  matches a padded credits row when it replaces one, and `check-audio` fails on a file credited
  twice, which is how three stale rows had gone unnoticed). `audio/samples.ts` fetches
  and decodes them once, on the first gesture that unlocks audio, and plays into the synth's master
  gain so the Geluid toggle mutes both. **`play` returning `false` is the whole fallback
  contract:** `createArenaSound` tries the clip for an event first and runs its oscillator branch
  when there is none, and the engine runs from the `engine` loop (rate `engineRate(speed)`, 0.7 at
  rest to 2.2 at 25 m/s, ramped over 80 ms) or from the drone. The clips are generated with
  ElevenLabs' Sound Effects API by `npm run arena:generate-audio` (one prompt per clip in
  `scripts/arena/generate-audio.ts`; loops requested seamless), credited row by row in
  `public/arena/audio/CREDITS.md`, and `npm run arena:check-audio` — in CI — fails on any clip
  without a file, over 200 KB, or without a credit row. A clip the server does not have is not
  reported; one that arrives and will not decode is reported to
  Sentry once with `kind: "audio"` and the clip name.
- **Haptics.** `input/haptics.ts`: `hapticPulses(events, me, previousHealth)` is pure and says
  which of spec §7's patterns a tick earns this player (hit 25 ms — read from health dropping, not
  from the `hit` event, which names the target's kind rather than who was hit; car impact 40–90 ms
  by speed; explosion `[90, 40, 120]` within 30 m; own death `[120, 60, 220]`; kill `[15, 40, 15]`;
  pickup 12 ms; wanted `[30, 30, 30]`). `createHaptics(navigator, enabled)` is the device side:
  pulses under `HAPTIC_MIN_GAP_MS = 80` apart are dropped unless the later outranks the earlier,
  Trillen off means silence, and a device that throws on a pattern is reported and ignored. iOS
  gets nothing, as the spec accepts.
- **Feedback.** `render/feedback.ts` is a pure fold per tick: a red vignette that flashes on damage
  and fades over 12 ticks, a shake of 4 px for a hit and 10 px for an explosion within 30 m that
  decays by a quarter per tick and is derived from the tick (so two frames of the same tick shake
  the same way — it is applied as a transform on the scene, `Scene.shake`, and the overlay is
  drawn outside it), a hit marker for 6 ticks when one of your shots lands (`hit` events now carry
  `ownerId`), and a heartbeat throb below 25 health. Under `prefers-reduced-motion` nothing shakes
  and the vignette plays alone. `components/cityArena/arenaFeel.ts` — `feelTick` — feeds sound,
  haptics and feedback from the same `state.events` on every tick of every loop, catch-up bursts
  included.
- **Settings** (`ArenaSettingsSchema`, spec §9.3): `vibrate` and `twinStick` default `true`,
  `forceLayout` is `"mobile" | "desktop"` or absent for "let the device decide". A stored value of
  the wrong shape falls back to the defaults and is reported, as before. The in-game menu
  (`ArenaSettingsSheet`: Geluid, Trillen, Besturing with Enkele stick and Indeling, Potje verlaten)
  opens from the HUD's Menu button and from Escape — which no longer closes the overlay; Sluiten
  does — and pauses nothing, because a potje with other people in it cannot wait for one of them.
- **Touch.** The right 55 % of the screen is an aim stick (`TouchStick side="right"`): push to aim
  and fire, release to stop; `Enkele stick` puts the Schieten button back and you shoot where you
  face. The aim stick is a second aim source in `InputState` (`setStickAim`) that wins over the
  mouse while held, so the per-frame mouse aim cannot clobber it. The first time the touch controls
  show, a one-line tip explains them; Begrepen stores `h3-arena-touch-tip-v1`.
- **Keyboard.** Tab held shows the tussenstand (the live scorebord, re-read twice a second) —
  bound in the capture phase on the window and stopped there, so the dialog's focus trap never
  moves focus off the game; 1/2/3 pick a weapon and the wheel cycles one notch per 40 px of travel.
  Both go through `input/weaponSelect.ts`, which turns a pick into the `weaponNext` edges the
  simulation understands, one tick pressed and one released, and gives up after eight presses so a
  weapon with no ammo — which the simulation skips — cannot spin the rack forever. While the menu
  is open the keyboard is suspended and anything held is released.
- **Still open after Plan 6.** The device check on a phone.

## Runtime (Plan 7 — car radio)

Plan 7 puts music in the cars. Nothing in the simulation or the netcode knows about it: the radio
is a leaf of the sound layer that follows the same "in a car" signal the engine loop already gets.

- **The dial.** `audio/radio/stations.json` is the manifest `npm run arena:generate-radio` writes:
  stations in order (`id`, `name`, `tracks`), each track a content-hashed file under
  `public/arena/radio/tracks/` with a title and the length that was asked for. `stations.ts` parses
  it with Zod at import — a manifest of the wrong shape fails the build, not a player — and
  exposes `RADIO_STATIONS`, `stationById` (unknown or absent id: the first station) and
  `nextStationAfter` (wrapping). An empty dial means there is no radio at all: `browserRadio`
  returns `null`, the menu shows no Zender select, R does nothing.
- **Playback** (`audio/radio/radio.ts`). One `<audio>` element per game, `preload="none"`,
  attached to Web Audio with `createMediaElementSource` and played through a gain of its own
  (`RADIO_GAIN = 0.5`) into the sound layer's master, so Geluid mutes it with everything else.
  `createArenaSound` owns it (`sound.radio`) and forwards to it: `updateEngine`'s `active` — in a
  car, not wrecked, boarding done — becomes `setInCar`, so getting in plays, getting out pauses
  and keeps the position, and a wreck falls silent; `unlock` on every gesture; `setEnabled` as
  `setSoundEnabled`; `dispose`. A shot or an explosion ducks it to 35 % for 0.3 s. A station
  switch starts the new station from the top; a track that ends moves to the next of the
  playlist and wraps. The element streams — nothing is decoded up front — and a `play()` the
  browser refuses for want of a gesture (`NotAllowedError`) is remembered and retried on the next
  gesture, not reported; the first gesture primes the element with a silent play-then-pause at
  gain 0 so the frame loop may start it later, on iOS too. A context that cannot attach media
  means no radio; a `play()` that fails for another reason is reported with `kind: "radio-play"`.
- **Settings** (spec §9.3): `radio` (default `true`) and `radioStation` (a station id; absent or
  unknown, the first station). The menu has a Radio switch and, with a dial, a Zender select.
- **Controls.** R switches to the next station (once per press, `KeyboardHooks.onRadio`), the
  touch buttons gain a Radio tap while in a car, the HUD names the station playing
  (`ArenaHud.radioStation`, from `hudRadioStation(runtime)`), and the desktop hint lists the key.
  A switch goes through the settings, so the station survives a reload.
- **Files and credits.** `scripts/arena/generate-radio.ts` asks ElevenLabs' Music API
  (`POST /v1/music`, instrumental, 120 s, `mp3_44100_96`) for each planned track that has no
  file yet — or every track of the stations named on the command line — names the file after its
  own SHA-256, deletes the file it replaces, and writes the manifest and
  `public/arena/radio/CREDITS.md` after each one. The hashed names are why `next.config.js`
  serves `/arena/radio/tracks/` immutable, like the map tiles. `npm run arena:check-audio` — the
  CI step — also audits the radio (`scripts/arena/check-radio.ts`): every track has a file under
  1.6 MiB and a credit row, the set is under 16 MiB (raised from 8 on 2026-09-10 for six
  stations), and no file lies in the directory that the manifest does not name.
- **Still open after Plan 7.** The listening check — `RADIO_GAIN` and `DUCK_LEVEL` are the
  knobs, `npm run arena:generate-radio <station>` regenerates a station — and the device check
  on a phone.

## Runtime (Plan 8 — netcode follow-ups and the lobby code)

Two gaps left open by Plans 3b and 6, and one request from the owner.

- **The server recognises the acting host.** `GET /api/arena/rooms` (which drops an advertised
  room whose advertiser is not its host) and `recordMatch` (which refuses a result from anyone but
  the host) used to ask the presence election — and an old host's presence entry outlives its tab
  by up to minutes, so a host that took over mid-potje had its advert hidden and its result
  refused. `net/roomHost.ts` now reads the room channel's presence set **and** its history through
  Ably REST: the best-ranked present member with a `state` message within `ACTING_HOST_FRESH_MS` (10 s)
  is the acting host (`actingHost` in `net/election.ts`) — a lower-ranked member only while
  everyone above it is silent, which is when the clients re-elect too; the presence election is
  the fallback for a room that has not started stepping. A host is someone you hear from — the
  rule the clients already live by. History without persistence keeps two minutes of messages,
  which is plenty; it costs one extra REST call per advertised room per listing (cached 5 s) and
  one per result. The trust model is unchanged in strength: the election already trusted
  self-declared roles, and clients still accept snapshots from the elected host only.
- **A cut, not a fly-over.** A joiner is seated wherever the host put it, usually kilometres from
  where it was roaming, and the camera's exponential ease flew across unrastered tiles to get
  there. `cutTo(runtime, point)` snaps the camera and sets `feedback.cutFade = 1`, which the
  feedback fold walks down to 0 over `CUT_FADE_TICKS` (12, 0.4 s) while `drawFeedback` paints the
  arena's void colour over the scene at that alpha. `adoptSeat` (the joiner), `applyTeleport` (the
  zone picker) and `recoverSeat` (a lost seat) all cut. Reduced motion keeps the fade: a fade is
  not motion, and the alternative is a hard cut.
- **The lobby code.** `ArenaLobby`'s header shows the code as a display-size, letter-spaced amber
  element (`data-testid="room-code"`) with a **Kopieer** button where the Clipboard API exists
  (**Gekopieerd** for two seconds after a copy; a clipboard failure is reported, not shown), and
  the zone name on the line under it.

## Runtime (Plan 9a — cars, people and weapons)

Plan 9 fills the city out; 9a is the simulation half (9b, the map half, adds trees and street
furniture). Nothing here changes the netcode: kinds and weapons are appended in wire order and the
two new ammo counts sit past the original player row, so an older row still decodes.

- **Nine vehicle kinds** (`sim/vehicle.ts`). `VehicleSpec` gained `steerRateRadS`, `healthMax`,
  `lengthM`, `widthM` and `massT`; the four originals keep every number they had, and `van`
  (Bestelbus), `pickup`, `bus` (Stadsbus, 12 × 2.5 m, 220 health, 12 t), `oldtimer` and `tractor`
  (Trekker, 8 m/s flat out) join them. `VEHICLE_KINDS` is the wire order: append, never reorder.
  The hull is circles along the body — `hullLayout(kind)`, one per ~2 m at the radius the width
  calls for, the originals' two at ±1.1 m and r 0.95 unchanged — used against walls and, in
  `sim/collisions.ts`, against each other: the contact normal runs centre to centre, the overlap is
  what the deepest pair of touching circles has to be pulled apart (a crossed pair included), and
  push and impulse split by mass, so a bus shoves a compact. Impact damage splits the same way
  (`sim/movement.ts`). People meet a kind's body rectangle grown by their radius and leave through
  the nearer face, so someone clipped at the side steps aside and someone hit head-on is carried
  in front — never pushed the length of a bus. `CAR_BODY_RADIUS_M` survives only as the clearance
  the traffic AI, the spawns and the exit keep around a car.
- **Where they appear** (`sim/spawn.ts`, `sim/traffic.ts`). `PARKED_CAR_KINDS` has six kinds;
  traffic draws from `TRAFFIC_KINDS_BY_CLASS` — buses on primary/secondary/tertiary roads,
  oldtimers on the quieter ones, never a sport car (the prize stays parked) — and
  `pickTrafficKind` makes one car in three on an unclassified road a tractor (`TRACTOR_CHANCE`;
  there is no point-to-ground lookup in the simulation, so the countryside is read from the road
  class). Ten to sixteen ambient cars and thirty-five pedestrians per zone; `MAX_TRAFFIC` 20,
  `MAX_PEDS` 60; `net/wire.test.ts` proves a world at every cap under `MAX_SNAPSHOT_BYTES`.
- **Art** (`scripts/generate-arena-sprites.js`, `render/sprites.ts`, `render/loadSprites.ts`).
  `vehicleSources` is a registry per kind with the kind's metre box and a `tint` flag — greyscale
  art is tinted from `CAR_BODY_COLOURS` (ten now, `VEHICLE_COLOUR_COUNT` with it), liveried art
  (police, bus, tractor) is drawn as is — and `personSources` lists the player, `ped1`…`ped6` and
  `cop`, each a still that the script turns into an eight-frame walk. The manifest's `vehicles`
  is a partial record over `VehicleKind` (a key that is no kind fails the parse, which
  `check-sprites` runs in CI) and `people` an open record; `ArenaSprites` keeps `car` (the
  sedan's) and `player`, and adds `vehicles` and `people`. `vehicleSpriteFor(art, kind, colour)` takes a kind's own art or the
  sedan's; `hasOwnVehicleArt` is what lets `drawVehicles` leave the vector light bar off a police
  car whose sprite carries one. Either way the lights glow and flash — and, within 120 m of this
  player, the siren loop plays — only while a police driver holds the car (`policeCarIds` and
  `sirenWithin` in `sim/police.ts`, `Scene.sirenVehicleIds`, `ArenaSound.updateSiren`; the
  owner's question of 2026-09-10, when the sprite had left the bar standing still and the siren
  clip had never been wired up). Every size in the painter comes from the kind. Sources were
  generated with SpriteCook (gpt-image-2, the sedan's prompt template and style snapshot,
  `bg_mode: "transparent"`; one render needed `remove_background`) and are credited in
  `public/arena/sprites/CREDITS.md`; `npm run arena:check-sprites` (`scripts/arena/check-sprites.ts`,
  a CI step) fails on a manifest file that is missing, over its cap (64 KB, 96 KB for a vehicle of
  8 m or more, 48 KB for a strip) or uncredited.
- **People with faces** (`sim/peds.ts`, `render/drawPeople.ts`, `render/drawPersonSprite.ts`).
  `pedLook(id)` is `id % PED_LOOKS` — nothing on the wire, every client agrees — and
  `pedLookName` is the manifest key. The strip painter that drew the player now draws pedestrians
  (walk speed from their mode) and cops (the `cop` strip) too, over the colour circle that keeps
  them findable zoomed out; a body keeps the flat marker. The painter reads `PED_RADIUS_M` and
  `PED_MAX_HEALTH` instead of its own copies.
- **Two weapons** (`sim/weapons.ts`). **Knuppel** (`bat`: melee, 30 damage at 1.6 m, 1.5/s,
  twenty swings, forty carried) and **Geweer** (`rifle`: 45 damage, 0.8/s, 70 m, 160 m/s, magazine
  of ten, thirty carried). `AmmoState` is `Record<MagazineWeapon, number>` and the helpers work
  from `MAGAZINE_WEAPONS`; `isMelee` is what withholds the muzzle flash. `WEAPON_ORDER` runs fist,
  bat, pistol, uzi, shotgun, rifle; keys 4 and 5 (`SLOT_WEAPONS`) reach the new pair and the
  selector gives up after twelve presses. Pickups: six gun spots rotating uzi/shotgun/rifle, four
  health, then two bats where spots remain (`MAX_PICKUPS` 18). Clips `bat` and `rifle` were
  generated with ElevenLabs behind synth tones.
- **Still open after 9a.** How the kinds drive and how the sprites read on a phone — the owner's
  eyes; every number lives in the two tables.
