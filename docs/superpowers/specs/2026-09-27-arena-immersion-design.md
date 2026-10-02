# GTA H3 — immersion pass: cockpit, muzzle shots, city sound, characters and city detail

Status: approved by the owner on 2026-09-27 (design in chat; "just build" — no spec review round).
Builds on the 3D mode (`docs/superpowers/specs/2026-09-26-arena-3d-mode-design.md`,
`docs/tech/arena/3D-MODE.md`, PR #741).

## 1. What the owner asked for

1. First person in a car must really be first person in the car: hands on the steering wheel,
   looking out through the windscreen.
2. Shooting in first person must visibly fire from the weapon, not from the middle of the body.
3. Environment and characters look "very Minecraft"; raise the quality and the diversity.
4. Walking around is silent until you shoot. Add street sounds, passing cars, people chattering,
   birds.
5. Spatial audio and proximity volume.

## 2. What the code does today (why each item happens)

| Item | Cause                                                                                                                                                                                                                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `cameraRig.firstPersonPose` puts the eye at `SEAT_EYE_HEIGHT_M` inside the car's closed exterior model. Its faces are culled from inside, so the driver floats over the road with a sliver of bonnet in view; there is no interior, wheel or hands.                                                                                                         |
| 2    | The flat sim fires every round from the shooter's position; `tracers.ts` draws them at `PERSON_CHEST_HEIGHT_M` (1.3 m) on the in-plane line, `bursts.ts` lights the muzzle flash at the body, and `projectiles3d.ts` starts rockets there. In first person the eye is at 1.65 m and the gun is drawn lower right, so rounds leave the centre of the screen. |
| 3    | Characters are chamfered vertex-coloured blocks on a 17-bone rigid rig (`characterParts.ts`); peds have six fixed looks (`pedLook = id % 6`). Façades are four canvas styles; streets carry little clutter; vehicles are slabs.                                                                                                                             |
| 4    | `audio/sound.ts` only reacts to sim events. There is no ambience. `footstep`, `skid` and `death` clips ship in `public/arena/audio/` but `clipFor` never plays them.                                                                                                                                                                                        |
| 5    | Every voice goes straight into one master gain: a cop firing 150 m away is as loud as your own gun; the siren is one global loop switched on within 120 m.                                                                                                                                                                                                  |

## 3. Decisions (owner, 2026-09-27)

- **Characters: CC0 glTF models** — Quaternius "Ultimate Modular Men/Women" packs from
  poly.pizza. The owner approved downloading 15 GLBs (≈22 MB source): men (CC0) Casual, Business
  Man, Hoodie, Worker, Punk, Beach, Farmer, SWAT; women Animated Woman ×2, Punk, Hooded Adventurer,
  Adventurer (CC0), Suit and Worker (labelled CC-BY on poly.pizza → credited). Sources are cached
  in `.cache/arena/characters/` (gitignored) and pinned by URL + sha256 in the pack script; only
  packed output ships (`public/arena/characters/`). `@gltf-transform/core` and
  `@gltf-transform/functions` become devDependencies.
- **Audio clips: generated with the owner's ElevenLabs Sound Effects API** through the existing
  `scripts/arena/generate-audio.ts` (≈5–7k credits), credited in `public/arena/audio/CREDITS.md`.
- **Delivery: parallel PRs**, one worktree per track, all against `image`:
  1. `feat/arena-cockpit-shots` — cockpit + muzzle-origin shots (§4, §5)
  2. `feat/arena-city-audio` — spatial audio + ambience (§6)
  3. `feat/arena-gltf-characters` — glTF characters and diversity (§7)
  4. `feat/arena-city-detail` — city and vehicle detail (§8)

  The owner's "visual quality" track is split into 3 and 4 so each stays reviewable; a small
  release PR afterwards bumps `package.json` to **0.6.0** and adds the `CHANGELOG` entry for all
  four (no track bumps the version, so they never conflict on it).

- **No spec review round**: the smaller rulings are made by the implementer and listed in each PR
  body.

## 4. Cockpit (track 1)

- In first person **while driving**, your own vehicle's exterior model is hidden (body, wheels,
  light bar) and a **cockpit** is drawn in the existing view-model pass (`viewModelPass.ts`: own
  scene, own camera copying the city camera, near plane 1 cm, depth cleared — so it never clips
  into the world and always draws whole). Everyone else still sees your car's exterior.
- The cockpit, in camera-anchored car space (it moves with the car, not with mouse-look):
  dashboard with a speedometer whose needle follows `|forwardSpeed|`, a steering wheel that turns
  with the same steer the 3D front wheels use (`trackSteer`, −1…1 → about ±120° of wheel), both
  forearms and hands gripping the rim at ten-to-two in the player's skin tone with the bead
  bracelet (reuse `viewmodel.ts`'s arm geometry), A-pillars, roof edge and header, a windscreen
  frame with a faint additive glass sheen, the rear-view mirror, door-top sills, and the bonnet in
  the car's own body colour (`bodyColour(kind, colour)`) running out to the nose so the driver can
  judge the car's front.
- One `COCKPITS: Record<VehicleKind, CockpitSpec>` table sets eye height, eye offset from the car
  centre, wheel radius/tilt/distance, dash height, bonnet length, pillar spread and roof height.
  Bus: high seat, big flat wheel, no bonnet (flat front glass). Tractor: open cab frame, fenders.
  Tank: a hatch/periscope frame, no wheel — both hands on grips. Police: the light bar's glow
  flickers faintly on the roof header when the siren runs.
- Wrecked or dead: the cockpit hides as the hands do today (death camera takes over).
- Camera: the seat pose comes from the cockpit table instead of `SEAT_EYE_HEIGHT_M`/`SEAT_SIDE_M`;
  a small sway (lean into turns by steer × speed, bounce by speed) is presentation only. Mouse-look
  keeps working (the existing driver's-seat yaw from `cameraYaw.ts`); pitch limits stay ±30°.
- Performance: one merged geometry per vehicle kind (cached like vehicle materials, freed by
  `disposeSharedAssets`), a handful of draw calls, nothing allocated per frame.

## 5. Shots leave the weapon (track 1)

- **Muzzle point.** First person on foot: the view model's barrel tip, converted to world space
  through the city camera (both passes share the camera's pose and lens, so the point lines up
  with the drawn gun). Everyone else (third person you, other players, cops): the gun in the
  character's hand via `Character3d.muzzleWorld(target)` (foundation commit — see §9).
- **Tracers** (`tracers.ts`): a round's drawn position blends from its shooter's muzzle to the
  sim's true in-plane point at chest height over the first `CONVERGE_M` (≈15 m) flown, eased, so
  every round visibly leaves the barrel yet lands where the flat hit-scan hits and the crosshair
  (still on the true line) stays honest. The tail never reaches back behind the muzzle.
- **Muzzle flash and light** (`bursts.ts`/`flashes.ts`): the world flash and its point light sit
  at the character's muzzle; in first person the view model's own flash stays and the world light
  moves to the view-model muzzle's world point.
- **Rockets and cannon shells** (`projectiles3d.ts`): the model and its smoke trail start at the
  launcher tube / tank barrel and converge the same way.
- A muzzle is looked up by the bullet's `ownerId` (players and cops); unknown owners (or characters
  outside draw distance) fall back to today's body-centre start.
- The muzzle positions are captured once per frame after the entity sync (a small
  `Map<ownerId, Vector3>` reused across frames) and handed to the effects.

## 6. City sound and spatial audio (track 2; 2D and 3D)

- **Listener.** Every frame the runtime sets the listener to the local player (or the car they
  drive) and a facing: the 3D camera yaw in 3D, screen-up (north, `−π/2` in sim angles) in 2D.
- **Spatial voices.** Every event with a position (shot, hit, explosion, collapse, door, pickup,
  hijack, impact — at its vehicle) plays through: distance gain (full within `refDistance`, inverse
  rolloff, silent past `maxDistance`; ranges per sound class — gunshot ≈ 150 m, explosion ≈ 300 m,
  footsteps ≈ 20 m, chatter ≈ 18 m, doors ≈ 30 m), a `StereoPannerNode` pan from the bearing
  relative to the listener's facing (sounds behind are slightly muffled), and a low-pass filter
  that closes with distance. Pure math in one module (`audio/spatial.ts`) so it is testable; nodes
  are built through the injectable context contract (fakes in tests gain `createStereoPanner` and
  `createBiquadFilter`; a context without them plays unpanned).
- **Positional loops.** A small voice pool (≈4) follows the nearest moving traffic/other players'
  cars: engine clip at a rate from speed, gain by distance, panned — cars can be heard passing.
  The police siren moves onto the actual police car(s) (nearest two). Your own engine stays
  un-spatialised.
- **Ambient bed.** Seamless loops crossfaded every ≈0.5 s from what surrounds the listener
  (read from the loaded map tiles and the live scene): `amb-traffic` (road length and moving
  traffic within ≈80 m), `amb-crowd` (peds within ≈30 m), `amb-birds` (trees, grass/forest ground
  within ≈60 m — evening birdsong), `amb-wind` (open fields/polder, few buildings), `amb-water`
  (near water). Levels ease, never jump.
- **Spot sounds** from real nearby sources, rate-limited and randomised: ped chatter snippets
  from a random ped within ≈18 m (murmured Dutch, unintelligible — no words the game has to
  own), bicycle bells, dog barks, car horns from nearby traffic, a distant church bell near the
  Cunera tower (Rhenen) every few minutes, a scooter passing.
- **Wired-in clips that already ship:** your footsteps at stride cadence while walking/running
  (and quieter ones for peds within a few metres), `skid` on hard cornering/braking, `death` on
  your own death.
- **Setting.** New `ambience: boolean` (default `true`) in `ArenaSettings`, switch
  "Omgevingsgeluid" in the Menu sheet next to Geluid/Radio; Geluid off still mutes everything.
- **Clips.** New clip names in `clips.ts` (loops ≈20–30 s, `loop: true`; one-shots 1–4 s),
  generated with ElevenLabs via `generate-audio.ts` prompts, checked by `arena:check-audio`, rows
  in CREDITS.md. A missing ambience clip is silent (no oscillator fallback for ambience).
- Budget: ≤ 24 simultaneous spatial one-shots (oldest/quietest dropped), total new audio
  ≤ 2.5 MB.

## 7. glTF characters and diversity (track 3)

- **Pipeline.** `scripts/arena/pack-characters.ts` downloads the pinned GLBs into
  `.cache/arena/characters/`, verifies sha256, and with gltf-transform: keeps the meshes and
  skeletons, keeps **one** set of the needed animations per rig (Idle, Walk, Run, Death, Punch,
  Gun_Shoot / Idle_Gun / Run_Gun or the pack's equivalents — the script lists what it keeps),
  quantises, and writes `public/arena/characters/<name>.glb` plus `manifest.json`. A
  `npm run arena:check-characters` audit (sizes, manifest ↔ files, credits) joins CI like
  `arena:check-audio`. Budget: ≤ 3 MB for all character files together.
- **Runtime.** Loaded lazily with the 3D view (three's `GLTFLoader`, meshopt if used), cloned per
  character with `SkeletonUtils.clone`, one `AnimationMixer` each: idle/walk/run blended by the
  measured speed (`Motion.speed`) with playback rate matched to stride, gun-aim upper body when
  `pose.aiming`, a punch/bat swing on the recoil kick, death then lie still. Weapons attach to the
  right-hand bone and `muzzleWorld` reads the held weapon's tip (§9).
- **Fallback.** Until the files have loaded, or when they fail (Sentry breadcrumb for network
  errors, captureException for a broken file), the current procedural characters draw — the
  `EntityFactories.character` contract does not change.
- **Diversity.** A ped's appearance is derived from its id (deterministic on every device): model
  (from the city set), per-material tints (tops, trousers, hair, shoes from curated palettes),
  8 skin tones, height 0.92–1.08×, optional accessories reusing `characterExtras` ideas where they
  fit (caps, glasses, backpacks). The **player** keeps the splash-screen identity (bald, red
  sunglasses, mint shorts, bead bracelet — built from the Beach model with tints and extras);
  other players keep their vest hue; **cops** are the SWAT model in Dutch police navy with the
  cap/badge colours of today's cop look.
- **Performance.** Mixers of characters beyond ≈40 m update at a reduced rate; beyond
  `CHARACTER_DRAW_DISTANCE_M` nothing draws (unchanged). At "laag" the far half uses the
  procedural character (LOD), keeping phones at today's cost.

## 8. City and vehicle detail (track 4)

- **Buildings.** More façade styles and a wider palette (red/brown/yellow/grey brick, several
  plaster tones), Dutch gable fronts (trapgevel/klokgevel) on narrow old-centre houses, lit
  shopfronts with awnings on ground floors along main streets and near landmarks, doors, balconies
  on flats, window sills/frames with a little real depth near the camera, roof overhangs, chimneys
  and dormers on pitched roofs. All deterministic by structure id (`idHash.ts`).
- **Streets.** Raised kerbs, red cycle paths (fietspad) along main roads where the road is wide
  enough, zebra crossings near junctions, grass verges; instanced clutter along pavements: parked
  bicycles and racks, bins/containers, bollards, traffic signs, planters — never inside the
  collision footprint of anything the sim knows (visual only; no new obstacles).
- **Vegetation.** Three tree species (round lime/oak canopy of several lobes, tall poplar,
  conifer) with per-instance size/colour variation; hedges along front gardens where space
  allows.
- **Vehicles.** Smoother silhouettes (bevelled edges, wheel arches), glowing head- and taillights
  (emissive, brake lights brighter when decelerating), yellow Dutch plates, mirrors, darker glass.
- **Sky/light.** Stars and a moon in the evening dome; soft light pools under street lamps
  (additive ground decals); faint vertex AO at wall bases.
- **Quality tiers.** New detail only on "auto" and "hoog" (and within a radius of the camera);
  "laag" keeps today's geometry. Draw calls per dense cell must not grow by more than ≈30 % at
  "auto" (instancing/merging as today).

## 9. Foundation (shared by all tracks)

Commit on `feat/arena-immersion-base` (branched from `image` 87d2155): this spec, the four plans,
and `Character3d.muzzleWorld(target: Vector3): boolean` implemented for today's procedural
character (`characters.ts`, tested) with the test fakes updated. Track 1 consumes it; track 3's
glTF character must implement it.

## 10. Global constraints

- All user-facing strings Dutch. No inline `style` props. Every `catch` reports to Sentry (or is a
  documented breadcrumb per AGENTS.md's noise policy). Exported symbols carry JSDoc and explicit
  return types. Functions ≤ 50 lines. Named constants, no magic numbers. Commit subjects ≤ 72
  chars.
- 3D stays a lazily imported chunk: nothing in `render3d/` or `view3d/` is imported by value
  outside them (`import type` only). three.js stays at `^0.186`.
- The simulation, the wire protocol (4) and the netcode do not change.
- Verification per track: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`
  (revert regenerated artefacts), plus a browser check with screenshots on the preview DB
  (`trainer@example.test` / `preview123`, "Stad verkennen", `?debug=1` for `window.__arena`).
