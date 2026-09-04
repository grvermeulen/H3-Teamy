# Stadsstrijd (City Arena) — Design Spec, Slice 1

**Date:** 2026-09-03 · **Status:** approved in brainstorming, awaiting written review · **Owner:** Guido Vermeulen

A GTA2-style top-down multiplayer game inside H3-Teamy, played on the real map of
Rhenen, Wageningen and Bennekom, mounted directly below the Space Invaders card.
Team members play against each other from their own phone or computer; a later slice
adds a TV mode where phones become controllers and a TV shows a dynamic split-screen.

---

## 0. Decisions log (from brainstorming)

| #   | Decision           | Chosen                                                                           | Rejected alternatives                                                               |
| --- | ------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | First slice        | Multiplayer arena on the real map                                                | Single-player city first; everything at once                                        |
| 2   | Realtime transport | Hosted realtime service (Ably, free plan)                                        | WebRTC P2P (fails on carrier NAT without paid TURN); Redis polling (150–300 ms lag) |
| 3   | Results            | Shared DB leaderboard (Prisma)                                                   | Local-only stats                                                                    |
| 4   | Netcode model      | Host-authoritative simulation + client prediction; Canvas 2D                     | Owner-authoritative (no shared NPCs); deterministic lockstep (worst-ping input lag) |
| 5   | Map                | One seamless OSM region + 500 m match zones, tiles streamed                      | Four standalone arenas; whole region with no zones                                  |
| 6   | TV mode            | Slice 2, but slice 1 is built TV-ready                                           | Everything in slice 1                                                               |
| 7   | Aiming             | Mouse aim on desktop, twin-stick on mobile (parity)                              | Facing-direction fire only                                                          |
| 8   | Haptics            | Vibration API on Android, opportunistic on iOS, visual/audio feedback everywhere | —                                                                                   |

Verified facts used by this spec (checked 2026-09-03): Ably free plan = 200 concurrent
connections, 500 msg/s, 6M messages/month. OSM bbox `51.94,5.53 → 52.02,5.72` contains
58,888 building ways, 13,580 highway ways (5,175 named). iOS Safari has no Vibration API;
the `<input type="checkbox" switch>` haptic trick works iOS 17.4–26.4 only inside a user
gesture and was patched in iOS 26.5. Café Onder de Linden is in Wageningen (Hagesteeg 16).
The repository is public (relevant for ODbL).

---

## 1. Goals and non-goals

**Slice 1 delivers**

- A playable 2–8 player deathmatch for logged-in members, on phones (iOS Safari, Android
  Chrome) and desktops (Chrome, Firefox, Safari), in portrait or landscape.
- Real streets with street names, buildings, water and land use for the whole region;
  recognisable landmarks (churches, pools, café, WUR campus buildings).
- Cars (enter/exit, arcade driving, damage, explosions), three weapons, pedestrians,
  police with wanted levels 0–3, pickups, 3-minute rounds, scoreboard.
- Shared team leaderboard persisted in Postgres.
- Architecture ready for TV mode (roles, priority host election, viewport-based renderer,
  controller-only input path).
- An autonomous e2e test harness (Section 12).

**Explicitly out of slice 1**

- TV mode UI (Scherm page, split-screen compositor, Controller UI, display token route) — slice 2.
- Missions/jobs, gangs, more weapons, garages, "busted", wanted levels 4–6, team modes,
  persistent cash/unlocks — slice 3+.
- Anti-cheat beyond host-side input clamping. This is a private team app; the trust model
  is "teammates".
- Mouse-free desktop fallback beyond keyboard-only movement + facing-direction fire.

---

## 2. Product shape and placement

**Name.** UI title **"Stadsstrijd"**. Never "GTA" in UI, code comments or assets
(trademark); no Rockstar art. Code namespace `cityArena`.

**Entry point.** `<CityArenaLauncher />` rendered in `src/components/EventList.tsx`
directly after `<SpaceInvadersLauncher />`. A `card` in the same visual language, Tailwind
utilities only (no inline `style`). Contents:

- Title, one-line pitch, primary button **"Spelen"**.
- **"Actieve potjes"**: live list from `GET /api/arena/rooms` (polled every 10 s while the
  card is visible) — e.g. _"Wageningen centrum · 3 spelers · bezig"_; tapping joins that room.
- **"Ranglijst"**: top 10 from `GET /api/arena/leaderboard` (wins, kills, K/D).
- Logged-out visitors see the card with **"Log in om mee te doen"** instead of "Spelen".

**Overlay.** `CityArenaOverlay` is dynamically imported (`ssr: false`) with the same
chunk-loading placeholder pattern as Space Invaders, rendered via portal into `document.body`
as `fixed inset-0 z-[3200]` with safe-area utilities (`pt-safe pb-safe-bottom-bar pl-safe
pr-safe`), `touch-none select-none`. Body scroll locked while open.

**Flow.**

1. **Lobby** — _"Nieuw potje"_ (creates a 6-char code) or _"Meedoen met code"_. Host picks
   the **strijdgebied** (zone): _Rhenen centrum · Wageningen centrum · WUR-campus · Bennekom_.
   Member list with device icons and colours. The simulation already runs: members free-roam
   the whole map (no zone limit, cops active) while waiting. Host presses **"Start"**
   (or **"Oefenen"** when alone — no leaderboard write).
2. **Countdown** 3 s, players teleported to zone spawns, heat reset.
3. **Match** 180 s.
4. **Scorebord** 10 s (kills, deaths, winner), results posted by the host if ≥ 2 members
   played.
5. Back to **Lobby** in the same room (rematch) or **"Potje verlaten"**.

**Attribution.** Every overlay screen shows _"Kaart © OpenStreetMap-bijdragers"_ in the
footer (ODbL). The generated map asset is a derived database released under ODbL in the
public repository.

**Language.** All UI strings Dutch (Section 16 glossary). Identifiers English.

---

## 3. Real-world map pipeline (build time)

`scripts/arena/build-map.ts`, run manually with `npm run arena:build-map`. Output is
**committed**; Vercel builds never call Overpass.

### 3.1 Source query

Overpass API, bbox `51.94,5.53,52.02,5.72`, converted to GeoJSON with `osm2geojson-lite`
(dev dependency; handles multipolygon relations such as the Nederrijn).

| Layer     | OSM filter                                                                                                                                                             | Notes                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Roads     | `highway` ∈ motorway, trunk, primary, secondary, tertiary, unclassified, residential, living_street, pedestrian (+ `_link` variants); `service` only inside zone discs | Cycle/foot paths dropped. Keep `name`, `oneway` when present                            |
| Buildings | `building=*`, footprint area ≥ 40 m², centroid within 1.2 km of any zone centre; landmark buildings always kept                                                        | Keep `building:levels` (default 2)                                                      |
| Water     | `natural=water` polygons (plus `landuse` ∈ reservoir, basin); waterway _lines_ are not used                                                                            | Impassable                                                                              |
| Ground    | `landuse` ∈ grass, meadow, farmland, forest; `leisure` ∈ park, pitch; `natural` ∈ wood, scrub                                                                          | Mapped to `grass`, `field`, `forest`; `urban` is the implicit default and is not stored |
| Landmarks | from `landmarks.config.ts` (below)                                                                                                                                     | Matching is case-insensitive substring on `name` plus tag filter                        |

Real-build note (gzip budget, §3.4): the shipped build uses `MIN_BUILDING_AREA_M2 = 40`,
`BUILDING_KEEP_RADIUS_M = 1200`, and simplification tolerances of 0.5 m for buildings /
4 m for ground and water (`BUILDING_SIMPLIFY_TOLERANCE_M` / `TERRAIN_SIMPLIFY_TOLERANCE_M`,
§3.3). Buildings are the dominant contributor to tile size for this real region — see the
measured per-layer gzip split in §3.4 — ahead of ground polygons (farmland/forest/grass
over the whole ~10 km bbox, unfiltered by zone proximity by design); see §3.4 for the
owner decision this led to on the total/per-tile budget.
A second real-build fix, unrelated to budget: `tilesCovering` (`tiles.ts`) clamps to the
actual tile grid (`tileGridSize`) — Overpass returns the complete geometry of any
way/polygon with at least one node inside the bbox, so long roads and large ground
polygons run tens of km outside the region, which previously spawned tiles far beyond the
grid.

### 3.2 Landmark config (`src/lib/cityArena/mapBuild/landmarks.config.ts`)

| key                     | Name match        | Tag filter                                                            | Style    | Zone anchor        |
| ----------------------- | ----------------- | --------------------------------------------------------------------- | -------- | ------------------ |
| `cunerakerk`            | "Cunera"          | `amenity=place_of_worship` or `building=church`                       | `church` | Rhenen centrum     |
| `gastland`              | "Feel Fit"        | `leisure` ∈ sports_centre, swimming_pool                              | `pool`   | —                  |
| `grote-kerk-wageningen` | "Grote Kerk"      | `amenity=place_of_worship`, within 800 m of Wageningen Markt          | `church` | Wageningen centrum |
| `onder-de-linden`       | "Onder de Linden" | `amenity` ∈ cafe, bar, pub, restaurant                                | `cafe`   | —                  |
| `de-bongerd`            | "Bongerd"         | `leisure` ∈ sports_centre, swimming_pool; pinned to `node/3014133762` | `pool`   | —                  |
| `wur-forum`             | "Forum"           | `amenity=university` or `building=university`                         | `campus` | WUR-campus         |
| `wur-orion`             | "Orion"           | same                                                                  | `campus` | —                  |
| `wur-atlas`             | "Atlas"           | same                                                                  | `campus` | —                  |
| `oude-kerk-bennekom`    | "Alexanderkerk"   | `amenity=place_of_worship`, within 800 m of Bennekom Dorpsstraat      | `church` | Bennekom           |
| `vrije-slag`            | "Vrije Slag"      | `leisure` ∈ swimming_pool, sports_centre                              | `pool`   | —                  |

Naming notes: OSM tags the Rhenen `gastland` complex (mid-rebuild) under its current
operator's brand, "Feel Fit Center Rhenen" — "Gastland" is absent from its `name` tag — and
the Bennekom church as "Oude of Sint-Alexanderkerk", not "Oude Kerk"; both name matches
above target the distinctive substring that is actually present. `de-bongerd` is pinned by
`osmId` because "Bongerd" also matches the WUR multi-sport complex around the pool
(`way/826591321`, "Sports Centre de Bongerd").

Rules: each entry must match **exactly one** element; zero or multiple matches fail the
build with the candidate list, resolved by adding an explicit `osmId` to the entry. Zone
centres are the centroids of their anchor landmarks; zone radius is 500 m. Landmarks are
rendered wherever they are; each zone's `landmarks` list is computed at build time as those
within its disc. POI landmarks that are nodes (e.g. the café) are attached to the building
polygon containing or nearest (≤ 15 m) the node. Landmarks that attach to no building use
the matched element's own outline as a one-level footprint; node landmarks without a
containing or nearby building render as labels only.

### 3.3 Transform (pure functions in `src/lib/cityArena/mapBuild/`, unit-tested)

- **Projection:** equirectangular at `lat0 = 51.98`, `lon0 = 5.625`, using WGS84 degree
  lengths evaluated at `lat0` rather than the equatorial values: `x = (lon − lon0) · P(lat0)`,
  `y = −(lat − lat0) · M(lat0)` (metres; north is up on screen), where
  `M(φ) = 111132.954 − 559.822·cos(2φ) + 1.175·cos(4φ)` and
  `P(φ) = 111412.84·cos(φ) − 93.5·cos(3φ) + 0.118·cos(5φ)` (φ in radians). The residual local
  scale error of this fixed-scale projection over the 13 km region stays below 0.1% (under
  0.5 m over a 500 m zone); the absolute position error is at most about 7 m at the bbox
  corners.
- **Quantisation:** coordinates stored as integers in units of 0.25 m.
- **Simplification:** Douglas-Peucker, two tolerances by kind (`BUILDING_SIMPLIFY_TOLERANCE_M`
  and `TERRAIN_SIMPLIFY_TOLERANCE_M` in `assemble.ts`). Buildings stay at the original
  0.5 m — a coarser tolerance collapses small footprints and drops sub-tolerance L-shaped
  notches, and building outlines are collision-relevant. Ground and water were raised to
  4 m during the real build (gzip budget, §3.1/§3.4) to thin background terrain outlines;
  buildings are the larger gzip contributor in the shipped build (measured split in §3.4),
  so this tolerance alone does not dominate the budget.
- **Tiling:** 2 km × 2 km tiles (8 000 units) on a grid anchored at the region's
  north-west corner (`y` grows south); geometry clipped to tiles with 20 m overlap so
  seams never show.
- **Road graph:** nodes at intersections plus shape points every ≥ 20 m; edges carry
  class, name index, one-way flag, length. Only drivable classes. Connectivity check per
  zone disc (largest component must contain ≥ 85 % of edges) fails the build otherwise.
  Lowered from 95 % during the real build: the WUR campus zone's real-world road graph
  tops out at 85.7 % (the rest are short disconnected service/parking spurs), and the
  brief's decision rule allows 85 % as the floor.
- **Spawn nodes:** per zone, road-graph nodes inside the disc, ≥ 8 m from any building and
  ≥ 6 m from water.

### 3.4 Output (`public/arena/map/v1/`)

- `index.json` — version, generation timestamp, origin, bounds, tile grid, zones
  (`key, name, center, radius, spawnNodes, landmarks`), landmarks
  (`key, name, style, center, tile`). Small (< 30 KB gz; 6.7 KB in the shipped build).
- `roads.json` — road graph (nodes, edges, names). Shipped at 183.4 KB gz (13 756 nodes,
  15 101 edges) — higher than the original ≈ 100–150 KB estimate; the region's real
  drivable network is denser than assumed pre-build.
- `tile_x_y.json` — `{ roads, buildings, ground, water }` with flat integer coordinate
  arrays; buildings carry `levels` and optional `landmark`. The region's real bounds (a
  ~52 km² box covering Rhenen, Wageningen, the WUR campus and Bennekom, most of it open
  countryside) tile into a 7 × 5 grid — 35 tiles, `tilesCovering` clamped to that grid
  (`tileGridSize`) so geometry outside the region never spawns extra tiles. Fringe tiles
  are tiny (as little as 0.1 KB gz); the four town/campus cores run larger, with the
  Wageningen–campus tile the largest at ≈ 204.0 KB gz — the two zones' 1.2 km keep-radius
  discs both reach into it, and it holds two non-anchor landmarks besides (`onder-de-linden`,
  `de-bongerd`). Measured per-layer gzip split across all 35 tiles (each tile's layer
  serialised and gzipped separately, summed): buildings ≈ 481 KB gz (~51 %), ground
  ≈ 306 KB gz (~32 %), roads ≈ 133 KB gz (~14 %), water ≈ 32 KB gz (~3 %) of the ≈ 949 KB
  tile total — buildings are the dominant contributor, not ground; recovering the 14 lost
  `type=building` relation outlines (review finding 1) and attaching/footprinting landmark
  buildings that used to be dropped (findings 2–3) tipped the balance.
- Polygons store their outer ring only; holes (courtyards, river islands) are dropped.
- Budget: total ≤ 1.2 MB gzipped (shipped at 1138.6 KB) and no single tile above 256 KB
  gzipped; the build fails otherwise (owner decision 2026-09-04: the total is a repo/CDN
  figure — a player only downloads the ≤ 9 tiles around them, so the per-tile cap is what
  bounds download time). See §3.1's real-build note for the constants that got the shipped
  build under both.
- `next.config.js` `headers()` adds `Cache-Control: public, max-age=31536000, immutable`
  for `/arena/map/:path*`. Any regeneration bumps the path version (`v1` → `v2`) via a
  constant in `src/lib/cityArena/constants.ts`. The service worker only caches
  script/style/image/font destinations, so HTTP caching is what makes tiles cheap.

---

## 4. Runtime world model (`src/lib/cityArena/world/`)

- **MapLoader** — fetches `index.json` and `roads.json` first (lobby can open), then tiles
  within one tile of the camera, prefetching in the direction of travel; LRU keeps ≤ 9
  tiles. Progress _"Kaart laden… 3/5"_. Fetch failures: 3 retries with backoff, then
  _"Kaart kon niet volledig laden"_; missing tiles render as hatched ground and play
  continues.
- **StaticRaster** (`render/staticRaster.ts`) — 128 m × 128 m chunk canvases rasterised on demand from tile vectors
  at one of three quantised zoom levels (4, 6, 8 px/m); LRU ≤ 24 chunks (≤ 40 MB). Paint
  order: ground → water → roads (width by class: primary 9 m, secondary 8, tertiary 7,
  residential/unclassified 6, living_street 5, pedestrian/service 4; dashed centre line on
  ≥ tertiary) → pavements (2 m each side, zone roads ≥ residential) → buildings (footprint,
  roof shade by `levels`, colour from a hashed palette) → **street names** along named
  segments ≥ 40 m, rotated with the road, flipped when upside down, one label per 120 m.
  Landmark styles: `church` = tower block + cross, `pool` = blue water rectangle inside the
  footprint, `campus` = green-glass blocks, `cafe` = terrace with parasols; each gets a name
  label. At most one chunk is rasterised per frame; intermediate zooms scale bitmaps.
- **CollisionGrid** — 16 m cells → building/water polygon ids. Circle-vs-polygon for
  people (r 0.4 m), four-corner test for cars, swept segment for bullets. Resolution pushes
  out along the least-penetration normal.
- **RoadGraph** — A\* with edge lengths; nearest-node lookup via the grid; used by AI
  traffic, cops, pedestrian pavement paths (road edge offset 3 m), car spawns.
- **Zone** — disc test, out-of-bounds timer, spawn selection.

Coordinates in metres as floats at runtime; the asset's 0.25 m integers are scaled on load.

---

## 5. Gameplay rules (slice 1)

**Simulation.** Fixed 30 Hz step on the host (`dt = 1/30`), seeded PRNG (`mulberry32`)
in the state; all randomness flows through it. Rendering at display refresh with
interpolation.

**Players on foot.** Radius 0.4 m; speed = 4 m/s × stick magnitude; aim independent of
movement; health 100, no regen. Death → respawn after 3 s at the spawn node maximising
minimum distance to alive enemies (seeded tie-break), 2 s blinking invulnerability.
Player colours from an 8-colour palette by join order; name label above the sprite.

**Weapons.**

| Weapon  | Source  | Ammo | Damage         | Rate  | Range | Projectile          |
| ------- | ------- | ---- | -------------- | ----- | ----- | ------------------- |
| Pistool | default | ∞    | 20             | 2.5/s | 40 m  | 120 m/s             |
| Uzi     | pickup  | 60   | 10             | 10/s  | 35 m  | 110 m/s, ±4° spread |
| Shotgun | pickup  | 8    | 5 pellets × 12 | 1.2/s | 15 m  | 90 m/s, 20° cone    |

Fire rate enforced host-side. Bullets are swept segments; they stop at buildings, hit
people (circle), cars (OBB — damage goes to the car; the driver dies only when the car
explodes), and despawn at max range.

**Cars.** Kinds: compact (accel 6 m/s², max 22 m/s), sedan (8, 28), sport (11, 36),
police (9, 30). Parked cars spawn along residential roads inside the zone at ≈ 1 per 40 m,
offset to the kerb; 6–10 ambient traffic cars follow the road graph at 8–12 m/s and stop
for obstacles. Enter within 1.5 m of a car (**Instappen**) → 0.6 s → driving; exit
(**Uitstappen**) places you beside the car. Physics: throttle/brake along heading, brake
14 m/s², reverse ≤ 8 m/s; angular velocity = steer × 2.6 rad/s × clamp(v/6, 0, 1) ×
(1 − 0.5·v/vmax); lateral velocity decays 90 %/s. Collisions: restitution 0.3, damage
= max(0, impact speed − 4) × 3 to both cars; buildings take none. Health 100 → smoke
< 40 → explosion at 0 (3 m radius, 80 damage, kills the occupant). Firing in a car is a
drive-by toward the aim direction. Running over people at > 5 m/s: damage = 5 × speed.

**Pedestrians.** ≈ 25 inside the zone disc + 100 m (fewer in lobby free-roam: 12 near
each player). States: walk (pavement polylines, random turns), flee (5.5 m/s away from
gunfire/explosions within 25 m for 4 s), dead (body persists 8 s). Killing one scores
nothing and adds heat.

**Wanted level (per player).** Heat: pedestrian kill +30, cop kill +60, shooting within
15 m of a cop +10, ramming a police car +20; decays 5/s after 8 quiet seconds;
level = min(3, ⌊heat / 40⌋). Level 1: two cops on foot spawn 60–120 m away out of view
and A\* to you, pistol at ≤ 20 m (1.5/s, 15° inaccuracy). Level 2: plus one police car
that chases and rams. Level 3: four cops, two cars, shotguns. Cops target the wanted
player; other players who kill cops gain heat. Your death resets your heat to 0.

**Pickups.** Per zone at match start: 6 weapon spots (up to 4 at landmarks, rest at seeded
spawn nodes; alternating Uzi/Shotgun) and 4 health spots (+50). Respawn 20 s after taken.

**Zone.** 500 m disc. Outside during a match: HUD _"Terug naar het strijdgebied! 5…"_
countdown, then 10 damage/s until back. No zone in the lobby.

**Round & scoring.** Countdown 3 s → 180 s → scoreboard 10 s. +1 per player kill; deaths
break ties (fewer wins); self-kills count as a death only. Winner(s) `won = true`.

**HUD.** Health bar, weapon + ammo, wanted stars, kills, timer, kill feed (last 4), and a
90 px **radar** (road lines, coloured player dots, pickups, zone edge). Synth SFX
(shots, explosion, engine pitch by speed, pickup, hit) with **"Geluid"** toggle; audio
context unlocked on the first tap.

---

## 6. Netcode (`src/lib/cityArena/net/`)

### 6.1 Transport abstraction

```ts
interface RealtimeTransport {
  connect(): Promise<{ clientId: string; serverTimeOffsetMs: number }>;
  channel(name: string): {
    publish(name: string, data: unknown): Promise<void>;
    subscribe(
      name: string,
      handler: (msg: {
        clientId: string;
        data: unknown;
        timestamp: number;
      }) => void,
    ): () => void;
    presence: {
      enter(data: PresenceData): Promise<void>;
      update(data: PresenceData): Promise<void>;
      leave(): Promise<void>;
      get(): Promise<PresenceMember[]>;
      subscribe(handler: (event: PresenceEvent) => void): () => void;
    };
    detach(): Promise<void>;
  };
  onConnectionState(
    handler: (
      state: "connected" | "connecting" | "suspended" | "failed",
    ) => void,
  ): () => void;
  close(): void;
}
```

Implementations: `ablyTransport` (production), `memoryTransport` (Vitest), `wsRelayTransport`
(Playwright, Section 12). Selection: production always Ably; the relay is available only
in builds with `NEXT_PUBLIC_ARENA_TEST_HOOKS=1`.

### 6.2 Ably wiring

- Client: `new Ably.Realtime({ authCallback })`; the callback fetches
  `GET /api/arena/realtime-token` and hands the SDK the `tokenRequest`, keeping `clientId`
  and `displayName` from the same response. Server: `new Ably.Rest({ key: ABLY_API_KEY })`
  per request.
- Token: `clientId = userId`, TTL 1 h, capability
  `{ "arena:room:*": ["publish","subscribe","presence"], "arena:lobby": ["subscribe","presence"] }`.
- Clock: `client.time()` once per connection → offset; snapshots carry host server time.

### 6.3 Channels and messages

| Channel                    | Who publishes                                         | Messages                                                                       |
| -------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `arena:room:<code>`        | host: `state`, `event`, `control`; members: `control` | presence with `PresenceData`                                                   |
| `arena:room:<code>:inputs` | every playing member                                  | `input`; **only the host subscribes**                                          |
| `arena:lobby`              | host of each room                                     | presence `{ roomCode, zone, players, phase }`, updated on change and every 5 s |

`PresenceData = { name, colour, role: "player" | "controller" | "display", device: "mobile" | "desktop", displayId?: string }`.
Join order comes from Ably's server-side presence `timestamp`, never from client clocks.

Hot-path payloads are flat arrays; control/event payloads are objects validated with Zod.

- `input`: `[seq, moveX, moveY, aim, flags]` — move components ints −100..100, `aim` 0..255
  (1/256 turn) or −1 for none, `flags` bitmask `fire=1, enter=2, weaponNext=4`. Sent on
  change plus a 2 Hz heartbeat, capped at 10 Hz.
- `state` (full snapshot, 10 Hz): `[tick, serverTimeMs, phase, roundEndsAtTick, players[],
vehicles[], peds[], cops[], bullets[], pickups[], lastInputSeqs]` with positions in 0.1 m
  ints and angles in 1/256 turns. Player row:
  `[id, x, y, aim, heading, health, weapon, ammo, vehicleIndex|-1, wanted, kills, deaths, flags]`.
  Estimated 2–3 KB for 8 players, 25 peds, 16 cars, 20 bullets (Ably limit 64 KB).
- `event` (per tick, only when non-empty): `kill(killer, victim, weapon)`, `explosion(x, y)`,
  `pickup(id, by)`, `wanted(player, level)`, `phase(new)`, `join(id, name, colour)`,
  `leave(id)`, `hostChanged(id)`, `damage(victim, total, kind)` coalesced per victim per tick
  (drives haptics and the vignette).
- `control`: `start { zone, seed, startsAtTick }`, `zone { zone }`, `join {}` (spawn request),
  `leave {}`, and `debug:* { … }` accepted only in test-hook builds.

### 6.4 Budget

Per 8-player, 3-minute match: inputs ≈ 8 × 6 Hz × 180 s ≈ 8.6k publishes, delivered once
to the host ≈ 17k messages; snapshots 1.8k × (1 + 8) ≈ 16k; events ≈ 2k. ≈ 35k messages →
≈ 170 such matches/month within 6M; a 4-player match ≈ 17k. Host simulates NPCs only inside
the zone disc + 100 m (lobby: within 150 m of any player).

### 6.5 Client-side prediction and interpolation

- Own player (and car while driving) simulated locally from local inputs with the same pure
  step functions. Inputs keep a ring buffer keyed by `seq`. On each snapshot: adopt host
  state for self, replay inputs with `seq > lastInputSeqs[me]`, blend residual position error
  over 100 ms (snap if > 3 m). Health, ammo, kills, hits, pickups: host only.
- Remote entities render at `serverNow − 120 ms`, interpolating between the two surrounding
  snapshots, extrapolating ≤ 100 ms when starved, then freezing.

### 6.6 Host election and migration

- Everyone sorts present members by `(rolePriority, presenceTimestamp, clientId)` with
  `rolePriority: display 0, desktop player 1, mobile player 2, controller 3`. The first is the
  host; snapshots are accepted only from that `clientId`.
- Host loop: `requestAnimationFrame` accumulator at 30 Hz; when `document.hidden`,
  `setInterval` fallback (browsers throttle it — migration covers the gap).
- Re-election triggers: host presence `leave`, or 3 s without a snapshot. The new host seeds
  its simulation from the last full snapshot (AI memory such as paths is rebuilt lazily),
  publishes immediately, emits `hostChanged` → toast _"Nieuwe host: Bram"_, and re-enters
  `arena:lobby` presence.
- Host tick exceptions: log to Sentry, skip the tick; 5 consecutive failures → stop
  publishing so the silence rule re-elects.

### 6.7 Rooms

6-char codes from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, generated client-side. Joining
requires ≥ 1 present member (otherwise _"Dit potje bestaat niet meer"_). Late joiners send
`control:join`, receive the next full snapshot, and are spawned by the host. Members who
leave are removed on presence `leave`. Room capacity 8 (host rejects the 9th with an
`event` and the client shows _"Potje is vol"_).

---

## 7. Controls and feedback (`src/lib/cityArena/input/`)

**Device detection.** `(pointer: fine) and (min-width: 768px)` → desktop layout, else
mobile layout; either can be forced in settings.

**Desktop.**

| Action                 | Keys                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| Move / drive           | WASD or arrows (car: W/↑ gas, S/↓ brake→reverse, A/D steer)               |
| Aim                    | mouse → world position; canvas crosshair, native cursor hidden            |
| Fire                   | left mouse or Space (hold = auto)                                         |
| Instappen / Uitstappen | F or Enter                                                                |
| Wapen                  | Q, mouse wheel, or 1/2/3                                                  |
| Scorebord              | hold Tab                                                                  |
| Menu                   | Esc (Geluid, Trillen, Besturing, Potje verlaten) — does not pause a match |

**Mobile (twin-stick, default).** Left 45 % of the screen: floating joystick appears under
the thumb (move; in a car y = throttle/brake, x = steer). Right 55 %: floating aim stick —
drag to aim, auto-fire while held, release to stop. Two ≥ 58 px buttons above it:
**Instappen/Uitstappen**, **Wapen**. Setting **"Enkele stick"**: a fire button replaces the
aim stick and you shoot where you face. Pointer events keyed by `pointerId`,
`touch-action: none` on the canvas, `touch-manipulation` on buttons, portrait and landscape
supported (landscape widens the view). First-run tip like Space Invaders' `TOUCH_TIP_KEY`.

**Input model.** `{ seq, move: [x, y], aim: angle | null, fire, enter, weaponNext }` — device
agnostic; the host does not know the device.

**Haptics (`haptics.ts`).** Patterns (ms): bullet hit 25 · car impact 40–90 by speed ·
explosion `[90, 40, 120]` · own death `[120, 60, 220]` · kill confirmed `[15, 40, 15]` ·
pickup 12 · wanted up `[30, 30, 30]`. Rate limit ≥ 80 ms between pulses, higher priority
pre-empts. Android: `navigator.vibrate`. iOS: a feature-tested adapter using the
checkbox-switch trick, enabled only when the probe succeeds and only for pulses that can
piggyback on the player's own touch input; never relied upon.

**Universal feedback (`render/feedback.ts`).** Red vignette pulse on damage, screen shake
(4 px hits, 10 px explosions), hit-marker flash when your shots land, low-health heartbeat
throb below 25. Setting **"Trillen"** (default on).

---

## 8. Rendering and performance (`src/lib/cityArena/render/`)

- **Viewport abstraction:** `renderScene(ctx, viewport: { rect, camera }, world, snapshotView)`.
  Slice 1 uses one viewport; slice 2 composes several (TV mode).
- **Camera:** follows the local player with 0.4 s velocity look-ahead (≤ 15 m), eased;
  zoom level chosen from viewport width so phones show ≈ 60 m across, desktops ≈ 120 m.
- **Frame:** blit visible chunks → pickups → cars (rounded body, windows, roof stripe,
  smoke when damaged) → peds/cops/players (head + shoulders, colour ring, name) → bullets
  and muzzle flashes → pooled particles (≤ 200). HUD is React DOM updated at 10 Hz from a
  ref (Space Invaders' `syncHud` pattern); the radar is a second small canvas.
- **Budgets:** draw ≤ 6 ms/frame on a mid-range Android; ≤ 1 chunk raster per frame
  (≈ 8 ms each); chunk cache ≤ 40 MB; ≤ 9 tiles resident; host tick ≤ 4 ms.
- **Debug overlay** (`?debug=1`, non-production builds): fps p50/p95, draw ms, chunks,
  tiles, Ably RTT, snapshot age, prediction error, host id.
- **DPR handling** identical to Space Invaders' `paint()` (canvas backing store = CSS size × DPR).

---

## 9. Persistence, API, auth, environment

### 9.1 Prisma (migration `add_arena_match`)

```prisma
model ArenaMatch {
  id         String   @id @default(cuid())
  createdAt  DateTime @default(now())
  roomCode   String
  zone       String
  startedAt  DateTime
  endedAt    DateTime
  hostUserId String?
  results    ArenaMatchResult[]

  @@unique([roomCode, startedAt])
  @@index([createdAt])
}

model ArenaMatchResult {
  id      String  @id @default(cuid())
  matchId String
  userId  String
  kills   Int
  deaths  Int
  won     Boolean

  match ArenaMatch @relation(fields: [matchId], references: [id], onDelete: Cascade)
  user  User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([matchId, userId])
  @@index([userId])
}
```

`User` gains `arenaResults ArenaMatchResult[]`. Migration lands on the preview database
first (`npm run db:migrate:preview`), production after merge (`npm run db:migrate:production`).

### 9.2 Routes (thin handlers, `getActiveUser(req)`, Zod in `src/lib/schemas/arena.ts`, logic in `src/lib/services/arenaService.ts`)

| Route                           | Purpose                                              | Notes                                                                                                                                                                                                                                                                                 |
| ------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/arena/realtime-token` | Ably `TokenRequest` + `{ clientId, displayName }`    | `displayName()` from `USER_CORE_SELECT`; 401 when not logged in                                                                                                                                                                                                                       |
| `GET /api/arena/rooms`          | Open rooms from `arena:lobby` presence via Ably REST | KV cache 5 s (`arena:rooms:v1`); KV errors swallowed with Sentry                                                                                                                                                                                                                      |
| `POST /api/arena/matches`       | Host posts results                                   | Body: `roomCode (6)`, `zone` enum, `startedAt/endedAt` ISO (60–600 s apart), `results[2..8]` of `{ userId, kills 0..200, deaths 0..200, won }` with unique userIds; poster must be in `results`; duplicate `(roomCode, startedAt)` → 200 `{ id, duplicate: true }`, else 201 `{ id }` |
| `GET /api/arena/leaderboard`    | Top 10                                               | Sort wins desc, kills desc; fields `userId, name, matches, wins, kills, deaths`; KV cache 60 s (`arena:leaderboard:v1`), invalidated on match post                                                                                                                                    |

Errors follow the house pattern: `Sentry.captureException(err, { tags: { component } })`,
`isDbUnavailableError` → `jsonDatabaseUnavailable()`, Dutch error strings.

### 9.3 Client storage (Zod-validated, Space Invaders `storage.ts` pattern)

- `h3-arena-settings-v1`: `{ vibrate: true, sound: true, twinStick: true, lastZone, forceLayout?: "mobile" | "desktop" }`.
- `h3-arena-pending-results-v1`: results whose POST failed after 3 retries; retried on the
  next launcher mount; toast _"Uitslag wordt later opgeslagen"_.
- `h3-arena-touch-tip-v1`: first-run touch tip dismissed.

### 9.4 Environment and dependencies

- New env var `ABLY_API_KEY` (server-only) in Vercel Preview + Production, `.env.example`,
  and `scripts/check-preview-env.ts`.
- Runtime dependency: `ably`. Dev dependencies: `ws` + `@types/ws` (test relay),
  `osm2geojson-lite` (map build).
- Build-time flag `NEXT_PUBLIC_ARENA_TEST_HOOKS=1` enables test seams (Section 12); never set
  on Vercel.

---

## 10. Play modes and TV-ready architecture

### 10.1 Slice 1: own device

Every member is a `player`: game view + controls on their own device.

### 10.2 Slice 2 design (recorded now so slice 1 does not paint itself into a corner)

Roles per member: **Speler** (own view + controls), **Controller** (phone shows only
controls, status strip, vibration, Wake Lock; downloads no tiles), **Scherm** (a browser at
`/arena/scherm` rendering the composite split-screen for all Controllers in the room; no
login). How the picture reaches the TV: smart-TV browser typing the room code or creating
the room and showing a QR code; laptop on HDMI or Chrome "Cast tab"; or the host phone in
the hybrid **Scherm + controller** role (landscape composite + translucent own controls),
mirrored via AirPlay/Chromecast. Casting a _different_ page from a phone is not reliably
possible on the web (no Presentation API on iOS; unreliable on Android), so it is not
promised.

Dynamic split-screen (`render/splitScreen.ts`, pure math): union-find clusters players whose
spread fits one camera (≈ 120 m); 1 cluster → full screen, 2 → dividing line through the
centre angled by the world direction between groups, 3–4 → 2×2 grid, 5+ → grid; rects,
camera centres and zooms ease exponentially; dividers fade on merge/split; raster zoom stays
quantised.

Extras in slice 2: `POST /api/arena/display-token { roomCode }` (capability limited to that
room, no user identity), `BottomNav` covered by the same fixed layer, gamepad support.

### 10.3 What slice 1 must already do for this

`role`/`displayId`/`device` in presence; priority-based host election (display > desktop >
mobile > controller); `renderScene` per viewport; input pipeline decoupled from rendering so
a controller client can publish inputs without a scene; `hostChanged` event; `displayId`
tolerated but unused.

---

## 11. Error handling and observability

- Every `catch` → `Sentry.captureException(error, { tags: { area: "arena", kind } })`, never
  silent. Cache failures never propagate.
- Connection banner (`ConnectionBanner`): `connecting`/`suspended` → _"Verbinding
  verbroken… opnieuw verbinden"_; `failed` → back to the lobby with the reason; token 401 →
  _"Log in om mee te doen"_; token 5xx → _"Kon geen verbinding maken, probeer het later
  opnieuw"_.
- Wire data: cheap structural guards (array lengths, finite numbers) on `state`; Zod on
  `control`, `event`, presence data, settings, API bodies. Invalid → dropped + Sentry
  breadcrumb (rate-limited to 1 capture/min per kind).
- Invariant checker (Section 12.A4) samples 1 % of production ticks and reports violations
  with `Sentry.captureMessage`.
- Tracing: `Sentry.startSpan({ op: "arena.match", name: zone })` from start to scoreboard with
  attributes `players, zone, durationS, snapshotAgeP95Ms, hostMigrations, messagesSent`;
  `logger.info` on host changes; `arena.map.load` span with tile count and bytes.
- Result posting: 3 retries with exponential backoff, then localStorage queue (Section 9.3).

---

## 12. Testing and autonomous end-to-end

### 12.A Test seams inside the game (compiled only with `NEXT_PUBLIC_ARENA_TEST_HOOKS=1`)

1. **Swappable transport** (Section 6.1). `wsRelayTransport` talks to
   `scripts/arena/relay.mjs`, a ~150-line Node WebSocket relay (dep `ws`) implementing
   channels, presence (with server timestamps) and publish, plus fault-injection commands:
   `latency(ms)`, `jitter(ms)`, `loss(ratio)`, `disconnect(clientId)`, `partition(groups)`.
2. **Deterministic simulation**: seed in `control:start`; same seed + inputs ⇒ same world.
   Replays run in Node (V8) against Chromium (V8) recordings exactly; WebKit/Firefox
   recordings compare with a 1e-3 m tolerance.
3. **`window.__arena` hooks**: `getPhase()`, `getState()`, `getLocalPlayer()`, `getMetrics()`,
   `setInput(input)`, `teleport(x, y)`, `teleportTo(landmarkKey)`, `spawnCar(x, y, kind)`,
   `giveWeapon(kind)`, `setHeat(n)`, `advanceRound(seconds)`, `startRecording()`,
   `stopRecording(): SessionLog`, `getInvariantViolations()`, `onEvent(cb)`. Host-only
   mutations travel as `debug:*` control messages accepted only in hook builds.
4. **Invariant checker** on the host every tick: finite numbers; positions in bounds;
   health ∈ [0, 100]; ammo ≥ 0; no entity centre inside a building after resolution; driver ⇔
   car consistency; kills equal kill events; monotonic round timer; every bullet has an
   owner. Test mode collects; production samples (Section 11).
5. **Bots** (`sim/bots.ts`, pure `(state, memory) → input`): `idle`, `wander`, `hunter`
   (approach nearest enemy with line of sight, fire in range), `driver` (nearest car → route
   to a landmark), `rammer`, `chaos`. Attach in-browser with `?bot=hunter` or in Node.
6. **Headless Node clients**: `scripts/arena/bot-client.ts` runs N bot players on the relay or
   on real Ably with a test key — no browser.
7. **Record & replay**: `SessionLog = { seed, mapVersion, inputsByTick, snapshots, events }`
   saved as `session.arenalog.json` on every failing test; `npm run arena:replay <file>`
   re-simulates in Vitest and diffs against recorded snapshots.
8. `data-testid` on all lobby, HUD, banner, scoreboard and leaderboard elements.

### 12.B Hermetic environment — `npm run test:arena:e2e`

- `playwright.arena.config.ts` (separate from the read-only deploy smoke config).
  `webServer`: relay on port 8787 and `next start` of a build made with
  `NEXT_PUBLIC_ARENA_TEST_HOOKS=1`; `globalSetup`: `prisma migrate deploy` +
  `tsx prisma/seed.ts --e2e` (assigns passwords to all seeded members) against
  `DATABASE_URL`. Postgres: CI service container `postgres:16`; locally
  `docker-compose.e2e.yml`. No Redis (KV returns `null`), no Sentry DSN.
- **Auth fixture** `loginAs("alex@example.test")`: programmatic credentials login
  (`/api/auth/csrf` → `/api/auth/callback/credentials`) → cached `storageState` per member;
  each player is its own browser context.
- **Projects**: `desktop-chromium`, `mobile-chromium` (Pixel 7, touch), `iphone-webkit`
  (iPhone 14, layout/render smoke only — no CDP multi-touch), `firefox-desktop` (nightly).
- **Input helpers**: CDP `Input.dispatchTouchEvent` for two-finger twin-stick gestures;
  keyboard/mouse helpers for desktop.
- **Scenario DSL** (`e2e/arena/dsl.ts`):

```ts
await scenario(test, { zone: "wageningen", seed: 42 })
  .player("alex", { device: "desktop" })
  .player("bram", { device: "mobile" })
  .bots(2, "hunter")
  .start()
  .do("alex", teleportTo("grote-kerk-wageningen"))
  .do("bram", teleportNear("alex", 10))
  .do("alex", bot("hunter"))
  .expectWithin(30_000, (s) => s.kills("alex") >= 1)
  .expectInvariantsClean()
  .finish();
```

### 12.C Suites by layer

1. **PR gate** (Agentic CI, new parallel job `arena-e2e`, ≈ 6 min): Vitest unit +
   memory-transport netcode (convergence after inputs, takeover after host leave) + map
   transforms against a recorded Overpass fixture + replay determinism; then Playwright
   **smoke**: desktop host + mobile client create/join/start, see each other, one kill,
   scoreboard, leaderboard row.
2. **Preview / post-merge** (existing read-only workflows, additive): launcher card renders
   logged-out with _"Log in om mee te doen"_; `GET /api/arena/leaderboard` → 200 JSON;
   `/arena/map/v1/index.json` → 200 with `immutable` cache header.
3. **Nightly** (`arena-nightly.yml`, schedule + `workflow_dispatch`): full scenario matrix
   across projects · **chaos**: kill the host → new host within 4 s, cars/health preserved;
   250 ± 100 ms latency and 3 % loss → snapshot age p95 < 400 ms, prediction error p95
   < 1.5 m · **soak**: 8 Node bots + headless host for 15 min → zero invariant violations,
   heap growth < 20 %, message rate within the Section 6.4 budget · **perf**: 4× CPU throttle
   → draw p95 ≤ 8 ms, ≤ 1 chunk raster/frame · **visual regression**: seeded camera shots at
   every landmark, 2 % pixel tolerance, baselines updated by PR · **map freshness**: Overpass
   check-mode run (no commit) → landmarks still found, tile sizes within budget, road graph
   connected per zone · **real-Ably lane** when secret `ABLY_TEST_API_KEY` exists: host +
   client on real infrastructure (token auth, presence, migration).

### 12.D Reporting and autonomy

- Each scenario writes `metrics.json` (per player: fps p50/p95, snapshot age, RTT,
  prediction error, migrations, invariant violations, message counts) checked against named
  budgets in `e2e/arena/budgets.ts`; a breached budget fails the job by name.
- Failures attach Playwright trace, video, `session.arenalog.json`, browser console and relay
  log. `playwright-report/arena-summary.json` is the machine-readable verdict for agents.
- Weekly job files a `flaky`-labelled GitHub issue for any test retried more than twice.
- `docs/tech/arena/TESTING.md` documents seams, DSL, budgets, how to add a scenario, and the
  manual device matrix (iPhone Safari, Android Chrome, desktop Chrome/Firefox, one real
  4-player session per release).

### 12.E Unit and component tests (Vitest, co-located)

Player/vehicle step, swept bullet collision, collision grid, heat/wanted, election order,
snapshot encode/decode round-trip with quantisation bounds, interpolation buffer, prediction
replay, zone timer, room-code alphabet, haptics rate limiter, input encoding, split-screen
layout (slice 2), projection/simplification/tiling/landmark matching, `arenaService` with
mocked Prisma/KV (the `userService.test.ts` pattern), route tests (token with mocked Ably
Rest; match posting validation and idempotency; leaderboard), launcher smoke test,
touch-stick hook tests. House rules apply: `vi.mocked`, `beforeEach(vi.clearAllMocks)`,
`vi.stubEnv`, no date-only strings.

### 12.F Stated trade-off

The hook flag makes the tested bundle differ from production by one module; game code is
identical, and the real-Ably lane covers what the relay cannot.

---

## 13. File layout (focused files, target < 400 lines each)

```
scripts/arena/                build-map.ts · buildMap.ts · overpass.ts (I/O only)
                              relay.mjs · bot-client.ts · replay.ts
public/arena/map/v1/          index.json · roads.json · tile_x_y.json
src/lib/cityArena/
  constants.ts · types.ts · schemas.ts · storage.ts
  mapBuild/  geometry · osmTypes · overpassQueries · landmarks.config · landmarks · roads · areas · zones · tiles · assemble · errors · fixtures/overpassMini
  world/     mapLoader · collisionGrid · roadGraph · zone · projection
  sim/       state · step · player · vehicle · weapons · bullets · peds · cops · pickups · spawn · round · bots · invariants
  net/       transport · ablyTransport · memoryTransport · wsRelayTransport · messages · election · hostLoop · clientLoop · roomCode · clock
  input/     inputState · keyboardMouse · touchSticks · haptics
  render/    camera · staticRaster · drawEntities · radar · particles · feedback · splitScreen (slice 2)
  audio/     sfx
  test/      hooks (window.__arena) · sessionLog
src/lib/ably/server.ts
src/lib/services/arenaService.ts (+ .test.ts)
src/lib/schemas/arena.ts (+ .test.ts)
src/app/api/arena/            realtime-token/route.ts · rooms/route.ts · matches/route.ts · leaderboard/route.ts
src/components/cityArena/     CityArenaLauncher · CityArenaOverlay · Lobby · MatchView · Hud · TouchControls
                              Scoreboard · Leaderboard · ConnectionBanner · useArenaSession
e2e/arena/                    dsl.ts · budgets.ts · fixtures/auth.ts · fixtures/touch.ts · *.spec.ts
playwright.arena.config.ts · docker-compose.e2e.yml
prisma/migrations/<ts>_add_arena_match/
docs/tech/arena/README.md · docs/tech/arena/TESTING.md
```

---

## 14. Delivery

- Branch `feat/city-arena` off `image`; work lands as a stack of reviewable PRs, each green
  on lint, `tsc --noEmit`, Vitest and CodeRabbit, with review threads resolved:
  1. map pipeline + committed assets + cache headers;
  2. world model + renderer + single-player free-roam (no network) behind the launcher;
  3. netcode (transport, election, prediction, lobby, rooms API, token route);
  4. gameplay completion (cars, weapons, peds, cops, pickups, zone, round);
  5. persistence (migration, matches, leaderboard) + launcher card lists;
  6. controls polish, haptics, SFX, settings;
  7. test seams, relay, DSL, CI jobs, docs.
     The implementation plan (writing-plans) breaks these into tasks.
- Migration policy: preview database first, production after merge.
- Docs: `docs/tech/arena/README.md` (summary, entry points, data model, env, runbook for
  `arena:build-map`) — auto-listed by `npm run docs:generate`.
- Definition of done for slice 1: PR-gate suite green; nightly suite green twice; one real
  4-player session (two phones, two laptops) with no invariant violations and snapshot age
  p95 < 300 ms on Ably; leaderboard populated on preview and production.

---

## 15. Risks and accepted trade-offs

| Risk                                        | Mitigation                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Host on a phone backgrounds or dies         | Priority election prefers desktops; 3 s silence rule; full-state snapshots make takeover cheap        |
| Ably free-plan limits                       | Section 6.4 budget; message counters in metrics; host-only inputs channel                             |
| Map data size on 4G                         | Tiles streamed by proximity, immutable caching, 1.2 MB total / 256 KB per-tile gzipped build ceilings |
| Real streets are irregular (not a GTA grid) | Zoom tuned to ≈ 60 m across on phones; radar; street labels                                           |
| iOS haptics                                 | Opportunistic only; universal visual/audio feedback                                                   |
| Cheating                                    | Accepted (teammates); host clamps inputs and fire rates                                               |
| ODbL / trademark                            | Attribution footer, derived asset in public repo, no "GTA" naming or assets                           |
| Overpass availability                       | Build is manual and committed; nightly freshness check only alerts                                    |
| Floating-point determinism                  | Replays compared exactly on V8, with tolerance elsewhere                                              |
| Tested bundle ≠ production bundle           | One hook module differs; real-Ably lane covers integration                                            |

---

## 16. Glossary (Dutch UI strings)

Stadsstrijd · Spelen · Log in om mee te doen · Nieuw potje · Meedoen met code · Actieve
potjes · Ranglijst · Strijdgebied (Rhenen centrum, Wageningen centrum, WUR-campus, Bennekom)
· Start · Oefenen · Instappen / Uitstappen · Wapen · Schieten · Gezocht (sterren) · Terug
naar het strijdgebied! · Scorebord · Nieuwe host: {naam} · Verbinding verbroken… opnieuw
verbinden · Kon geen verbinding maken, probeer het later opnieuw · Dit potje bestaat niet
meer · Potje is vol · Kaart laden… · Kaart kon niet volledig laden · Uitslag wordt later
opgeslagen · Geluid · Trillen · Enkele stick · Besturing · Potje verlaten · Kaart ©
OpenStreetMap-bijdragers.
