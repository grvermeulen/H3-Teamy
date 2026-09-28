# GTA H3 — shooter aiming, touch controls, drive-bys and rounder cars

Status: approved by the owner on 2026-09-28 (design in chat; decisions below). Builds on the
immersion pass (`2026-09-27-arena-immersion-design.md`, PRs #744–#749, 0.6.0).

## 1. What the owner asked for

1. In 3D the crosshair, aim and shot must really follow the mouse, as in other shooters, with aim
   down sights (ADS) on the right mouse button, and a good mobile equivalent.
2. On mobile, turning to look around must not pull the trigger.
3. In a car, shooting shows the gun held out of the window, firing from outside it.
4. `M` opens the map.
5. The cars still look like blocks; make them look properly 3D.

## 2. What the code does today

| Item | Cause                                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `overlay3d.crosshairScreen` draws the crosshair where the flat shot line is 25 m ahead at chest height, so it drifts off centre when the view pitches, and in third person (camera over the right shoulder) the shot does not go where the camera looks. The sim aim is the camera yaw, whatever is under the crosshair. |
| 2    | The twin-stick layout's aim stick both aims and fires (`useArenaGame`: "a pushed stick aims and fires"); in 3D it also turns the camera (`cameraYaw.stickTurnedYaw`), so every look fires.                                                                                                                               |
| 3    | Drive-bys already work in the sim (`combat.applyFire`), but the 3D player is hidden in a car and the cockpit keeps both hands on the wheel.                                                                                                                                                                              |
| 4    | The map opens only from the HUD button (`CityArenaOverlay.openMap`); `M` is unbound.                                                                                                                                                                                                                                     |
| 5    | Vehicle bodies are slab assemblies (`vehicleShapes*.ts`), bevelled in #748 but still boxy.                                                                                                                                                                                                                               |

## 3. Decisions (owner, 2026-09-28)

- **Cars: Kenney "Car Kit" (CC0)** — the owner approved downloading
  `https://kenney.nl/media/pages/assets/car-kit/1a312ec241-1775131960/kenney_car-kit.zip`
  (4.8 MB). Sources cached in `.cache/arena/cars/` (gitignored), pinned by sha256; only packed
  models ship (`public/arena/cars/`). Bus, oldtimer and tank keep procedural bodies, smoothed.
- **ADS changes gameplay**: while aiming down the sights a spraying gun's cone is halved
  (`ADS_SPREAD_FACTOR` 0.5 — uzi, shotgun) and walking slows to `ADS_WALK_FACTOR` 0.55. The input
  frame carries an `ads` flag → **arena protocol 5**.
- **Mobile**: look pad + hold-to-fire button (drag while holding to keep aiming) + ADS toggle,
  **with light aim assist** (look slows over a target). 2D keeps today's twin-stick.
- Delivery again as parallel PRs from one foundation commit; a release PR (0.7.0) afterwards.

## 4. Foundation (commit on `feat/arena-aim-base`)

- `WorldInput.ads?: boolean` (absent = not aiming); `createInput` sets it only when true.
- Wire: `FLAG_ADS = 16` in the input frame's flags (`net/wire.ts`); `ARENA_PROTOCOL_VERSION = 5`.
- Sim: `stepPlayer` multiplies its speed factor by `ADS_WALK_FACTOR` while `input.ads`
  (covers host, offline and client prediction) — except with fists or the bat, which have no
  sights (`walkingInput`, applied by the host's walk and the client's prediction); `applyFire`
  fires with `aimedSpec(spec, ads)` (`sim/weapons.ts`).
- Input: `ButtonName` gains `"ads"`; `InputState.snapshot()` sets `ads: true` while any source
  holds it (pointer = right mouse, buttons = touch toggle).

## 5. Shooter aiming on desktop (track A — `feat/arena-fps-aim`)

- **Centred crosshair** in both camera modes: drawn at the screen centre, always.
- **Aim probe** (new `render3d/aimProbe.ts`): each frame a ray from the city camera through the
  screen centre is tested against characters (vertical capsules), vehicles (oriented boxes from
  `lengthOf/widthOf/vehicleHeight`), buildings (footprint prisms from the collision grid up to
  their height; destroyed ones skipped), and the ground plane; the nearest hit within the weapon's
  range is the **aim point** (else the point at range along the ray). The runtime's sim aim
  becomes the flat heading from the local player (or their car) to the aim point — so in third
  person the round goes where the crosshair points — falling back to the camera yaw when the
  point lies within 1 m of the player.
- **Tracers and rockets** of the local shooter converge from the muzzle onto the ray toward the
  aim point, including its height (roofs, first floors) — presentation only; the sim stays flat.
  Everyone else's rounds converge onto the flat line as today.
- **ADS on the right mouse button (held)**: `pointer` source of the `ads` button; the browser
  context menu is suppressed on the playfield. Presentation: first-person FOV 70° → per-weapon
  zoom (pistol/uzi/shotgun 50°, rifle 24° with a scope overlay on the HUD canvas, rocket 45°),
  the view model eases (0.15 s) into a sights pose with the barrel on the crosshair and the bob
  damped; third person the camera eases in over the shoulder (back 3.6 → 1.9 m, FOV 60 → 45°).
  Mouse sensitivity scales with `tan(fov/2)` so a zoomed view does not whip.
- **Mouse sensitivity** setting (`mouseSensitivity`, 0.25–2.5×, default 1) in the Menu,
  "Muisgevoeligheid"; raw pointer-lock deltas, no smoothing.
- **`M`** toggles the map (opens the same dialog as the HUD's map button; Escape closes it).
- ADS in a car: the camera zooms but the car keeps driving (drive-by aim, §7).

## 6. Touch controls in 3D (track B — `feat/arena-touch-3d`)

- In 3D on a touch device (not in 2D), the right-hand controls become:
  - **Look pad**: the right half of the screen outside the buttons; a drag turns yaw/pitch at a
    touch sensitivity (tunable, "Kijkgevoeligheid"), never fires.
  - **Fire button** (big, bottom right): hold to fire; a drag that starts on it also looks, so the
    thumb can hold fire while tracking a target.
  - **ADS toggle** above it (scope icon, "Richten"): toggles the `buttons` source of `ads`.
  - The existing enter-car / weapon / camera buttons stay.
- **Aim assist (touch only)**: while the crosshair is within ~2° (screen-space ~40 px at 1080p,
  scaled) of a living target (other players, cops, peds; not your own car), look speed is
  multiplied by 0.45 ("friction"); no auto-rotate, no auto-fire. Pure module `aimAssist.ts` over
  the scene's targets and the camera.
- In a car on touch: the left stick steers as today; the look pad turns the camera; the fire
  button drive-bys.
- 2D, split screen and the TV controller are unchanged. A first-run tip explains the new layout
  (Dutch).

## 7. Drive-bys (track C — `feat/arena-drive-by`)

- A player in a car **holding a gun** shows it while they fire (a shot within the last 1.2 s) or,
  for the local player, while ADS is held: in third person (every client) an arm in the player's
  skin/sleeve colour and the held weapon reach out of the window on the aim side — driver window
  (left) when aiming left of the heading, passenger window (right) when right, and forward over
  the dash through the (implied) open windscreen within ±35° of ahead; the gun points along the
  aim (the local aim, or a remote driver's `facing`). Muzzle flashes and tracers leave that gun
  (`muzzleMap` gains the driver's muzzle).
- In the first-person cockpit the right hand leaves the wheel (the wheel keeps turning under the
  left hand) and holds the gun out of the window or over the dash, pointing along the aim; its
  muzzle is the local muzzle in first person.
- Tank: no arm (it fires its cannon). Bus: the arm comes out of the driver window only.

## 8. Kenney cars (track D — `feat/arena-kenney-cars`)

- `scripts/arena/pack-cars.ts` downloads the approved zip into `.cache/arena/cars/`, verifies its
  sha256, extracts the GLB models, maps them to our kinds (compact → hatchback, sedan → sedan,
  sport → sedan-sports/race, police → police, van → van, pickup → truck/pickup, tractor →
  tractor; bus, oldtimer, tank stay ours) and packs them (gltf-transform: dedup, prune, strip
  unused, merge meshes per material) into `public/arena/cars/<kind>.glb` + `manifest.json` +
  `CREDITS.md`; `npm run arena:check-cars` joins CI. Budget ≤ 1.5 MB.
- Runtime: lazily loaded like the characters; `buildVehicleModel(kind, colour)` returns the glTF
  body scaled to the sim footprint (`lengthOf × widthOf`, height to `VEHICLE_HEIGHT_M`), facing
  +X, the body-paint material tinted `bodyColour(kind, colour)` (Kenney models use a shared
  colour atlas — tint the paint region or swap the palette texture per colour, decided by probe),
  wheels as separate spinning/steering objects (from the kit's wheel models, or split from the
  body by the pack script), police light bar kept (our lenses on the roof), headlamp/taillamp/
  brake glow and plates from #748 re-placed on the new bodies (per-kind lamp positions in the
  manifest), wreck charring by material colour swap. Until loaded (or on failure) today's
  procedural models draw.
- The bus, oldtimer and tank: smoother procedural silhouettes (rounded roof, curved front,
  wheel arches) in the same style.

## 9. Global constraints

- Dutch user-facing strings; no inline `style`; JSDoc + explicit return types on exports;
  functions ≤ 50 lines; named constants; Sentry on every `catch`; commit subjects ≤ 72 chars.
- `render3d/` imported by value only inside `render3d/` and `view3d/`; three.js `^0.186`.
- No sim or wire changes beyond the foundation's `ads`.
- Verification per track: `tsc`, `lint`, `vitest run`, CI build; browser check on the preview DB
  (`trainer@example.test` / `preview123`, `/arena/spelen?debug=1`, "Stad verkennen"), a touch
  check via `resize_window` preset `mobile` (touch emulation) for track B.
