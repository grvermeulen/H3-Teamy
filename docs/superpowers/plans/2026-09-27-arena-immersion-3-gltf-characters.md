# Immersion track 3 — glTF characters and diversity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Pure logic is written test-first (superpowers:test-driven-development); visual tasks end with a browser screenshot.

**Goal:** Replace the blocky procedural people with Quaternius' CC0 low-poly characters, animated, and make every pedestrian look different — deterministically from its id on every device.

**Architecture:** A build script downloads the owner-approved GLBs (pinned URL + sha256), strips duplicated animations and packs them into `public/arena/characters/` with a manifest. The 3D view loads them lazily; a glTF character implements the unchanged `Character3d` contract (including the foundation's `muzzleWorld`) with an `AnimationMixer` driven by the existing `PoseInput`. Until the files load (or if they fail) the procedural characters keep drawing.

**Tech Stack:** three.js 0.186 (`GLTFLoader`, `SkeletonUtils`, `AnimationMixer`), `@gltf-transform/core` + `@gltf-transform/functions` (new devDependencies, owner-approved), TypeScript 6.0.3, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-27-arena-immersion-design.md` §3, §7, §9, §10.

## Global Constraints

- Dutch user-facing strings; no inline `style`; JSDoc + explicit return types on exports; functions ≤ 50 lines; named constants; every `catch` → Sentry (a network failure fetching a character file is a breadcrumb per AGENTS.md's transient-fetch policy; a file that arrives and will not parse is `captureException`); commit subjects ≤ 72 chars.
- `render3d/` imported by value only inside `render3d/` and `view3d/`; three.js stays `^0.186`.
- Download **only** the 15 approved files below; nothing else from the network. Sources go to `.cache/arena/characters/` (gitignored); only packed output is committed. Packed output ≤ 3 MB total.
- The `EntityFactories.character(look, vestHue)` contract does not change for callers; `Character3d` gains nothing beyond the foundation's `muzzleWorld`.
- Branch `feat/arena-gltf-characters` from `feat/arena-immersion-base`; PR against `image`; no version bump.

## Approved sources (static.poly.pizza, Quaternius, Ultimate Modular Men/Women packs)

| Key | GLB uuid | Poly Pizza page | Licence |
| --- | --- | --- | --- |
| `casual-man` | `90a9e2d4-053f-42f1-99a2-8f5e1180ea7f` | `/m/kZ3DmIoGip` | CC0 |
| `business-man` | `e599abbe-7d73-488c-9d7e-3ead281e705c` | `/m/JFrLIKqvCH` | CC0 |
| `hoodie-man` | `bcd66ec5-5e81-4901-a222-47abc875fe2a` | `/m/gKLBoRsyKe` | CC0 |
| `worker-man` | `3a5f3056-ffe6-42eb-bd52-122afcbd22b2` | `/m/Yg2bQZO6Hj` | CC0 |
| `punk-man` | `e56f23b5-3270-406f-8924-f77cad980c43` | `/m/BTALZymknF` | CC0 |
| `beach-man` | `f771a536-1c18-4a47-bb56-ceea4b603455` | `/m/DojKLcO34E` | CC0 |
| `farmer-man` | `81f2f0cf-6f53-4b57-92ea-dba0928620f2` | `/m/7pn3R6hPvE` | CC0 |
| `swat` | `713f6535-f4f3-4367-a4c6-ced126ae0936` | `/m/Btfn3G5Xv4` | CC0 |
| `woman-a` | `46d6db5a-3c9f-4238-8cdf-8eb7194498dc` | `/m/nIItLV9nxS` | CC0 |
| `woman-b` | `ba7a1955-ea51-4cb9-a561-188bdef0a6c7` | `/m/qJ2gsTUBHL` | CC0 |
| `punk-woman` | `1d368679-1d9a-4d5c-9095-877144b02d00` | `/m/djXoqejw6w` | CC0 |
| `adventurer-woman` | `69689495-028d-4b81-8678-792338a5693e` | `/m/ZwF0K7WBmu` | CC0 |
| `hooded-woman` | `3186b8e9-afd5-4d48-846c-b2b530cd23e2` | `/m/y9KWOVG21R` | CC0 |
| `suit-woman` | `1bd7759c-ab76-4178-8fe6-7706dffa7d5f` | `/m/sOUciDsoVV` | CC-BY 3.0 (per poly.pizza) |
| `worker-woman` | `c0253218-85f2-4d67-b3f2-a4611a7901fe` | `/m/E8079Ahx7k` | CC-BY 3.0 (per poly.pizza) |

URL: `https://static.poly.pizza/<uuid>.glb`. The page ids were read from the bundle pages in listing order; confirm each page's model name matches its key before writing credits (the page's HTML contains its GLB uuid).

## File map

| File | Change |
| --- | --- |
| `scripts/arena/pack-characters.ts` (+ `packCharacters.test.ts`) | **new** — download/verify/pack; `--probe` prints meshes, materials, skeleton bones, animations |
| `scripts/arena/check-characters.ts` (+ test) | **new** — manifest ↔ files, sizes, credits; `npm run arena:check-characters` + CI verify step |
| `public/arena/characters/*.glb`, `manifest.json`, `CREDITS.md` | packed output |
| `src/lib/cityArena/render3d/characterAssets.ts` | **new** — lazy load, parse, cache, dispose |
| `src/lib/cityArena/render3d/characterAppearance.ts` | **new** — pure: id/look → model key, tints, scale, extras |
| `src/lib/cityArena/render3d/characterAnimation.ts` | **new** — pure: `PoseInput` + motion → clip weights/rates |
| `src/lib/cityArena/render3d/gltfCharacter.ts` | **new** — `Character3d` over a cloned glTF + mixer |
| `src/lib/cityArena/render3d/characters.ts`, `cast3d.ts`, `entities.ts`, `contacts3d.ts`, `sharedAssets.ts`, `index.ts` | factory with fallback + LOD; ped appearance by id; disposal |
| `public/sw.js` | only if `/arena/characters/` is not already covered by the network-first `/arena/` rule (check) |
| `docs/tech/arena/3D-MODE.md` | characters section, module map, screenshots |

---

### Task 1: Download, probe, pack

- [ ] Add devDependencies `@gltf-transform/core` and `@gltf-transform/functions` (`npm install -D`; keep `package-lock.json` changes to those packages). **Note:** this worktree's `node_modules` is a junction to a shared directory — the install lands there too, which is fine (additive).
- [ ] `pack-characters.ts`: a `SOURCES` table (key, uuid, page, licence, **sha256**). First run downloads to `.cache/arena/characters/<key>.glb` and prints the sha256 of each; write those hashes into `SOURCES` and from then on refuse a file whose hash differs. `--probe` prints per file: meshes (+ triangle counts), materials (names + base colours), skeleton bone names, animation names + durations. Run the probe and record the findings in the PR body (which bones/materials/animations exist; whether men and women share bone names).
- [ ] Pack: per model keep meshes + skin + materials; keep animations from **one** source per distinct skeleton (men, women) — the clips the game needs: idle, walk, run, death, punch, gun idle/aim, gun shoot, plus a melee swing if present; write them as `public/arena/characters/anim-<rig>.glb`; strip animations from the rest; `dedup`, `prune`, `quantize` (and `meshopt` only if `three/addons` `MeshoptDecoder` loads cleanly under Turbopack — otherwise skip it). Write `manifest.json` (Zod schema in the script and in `characterAssets.ts`: `{ models: Record<key, { file, rig, gender, materials: string[] }>, animations: Record<rig, { file, clips: Record<ClipRole, string> }> }`) and `CREDITS.md` rows (title, author Quaternius, page URL, licence).
- [ ] Tests (`packCharacters.test.ts`): hash mismatch refused; manifest schema round-trip; clip-role mapping picks the right names from a probe-like list (e.g. `"Walk"`, `"Run"`, `"Idle_Gun"`, `"Gun_Shoot"` — adapt to the real names found). Use an injectable fetch/fs like `scripts/arena/files.ts` (vi.mock of `node:fs/promises` does not reach `scripts/arena/*` here).
- [ ] `check-characters.ts` + `npm run arena:check-characters` + a step in the CI verify job next to `arena:check-audio` (find it in `.github/workflows/`); budget ≤ 3 MB.
- [ ] Commit `feat(arena): pack CC0 glTF characters for the 3D view`.

### Task 2: Appearance by id

**Files:** create `render3d/characterAppearance.ts` (+ test).

```ts
export type Appearance = {
  model: CharacterModelKey;
  /** material name → sRGB hex tint (multiplied over the base colour or replacing it — decide by probe). */
  tints: Readonly<Record<string, number>>;
  /** Uniform scale around 1 (0.92…1.08). */
  scale: number;
  extras: readonly AppearanceExtra[];   // e.g. "cap" | "glasses" | "backpack" | "sunglasses-red" | "bracelet"
};
export function appearanceOf(look: CharacterLook, id: number, vestHue?: number): Appearance;
```

- Peds (`ped1…ped6` looks today, id-seeded): pick from the city set (all keys except `swat`), tints from curated palettes per material role (skin 8 tones; hair black/brown/blond/red/grey; tops; trousers; shoes), scale, 0–2 extras. `player`: `beach-man` with the splash-screen identity — bald (hide/skin-tint the hair material), mint shorts, red-lensed sunglasses, bead bracelet (reuse `characterExtras` geometry attached to head/wrist bones where practical). `otherPlayer`: a fixed male/female model with the vest hue on the top. `cop`: `swat` in Dutch police navy with light-blue shirt accents and the cap/badge of today's cop look where the model allows.
- [ ] Tests: deterministic (same id → deep-equal appearance); ≥ 40 distinct appearances over ids 0…199; skin tones spread over all 8; the player is always the beach model with red sunglasses; cops always `swat`; scale within bounds.
- [ ] Commit `feat(arena): give every pedestrian their own look`.

### Task 3: Animation mapping

**Files:** create `render3d/characterAnimation.ts` (+ test).

```ts
export type ClipRole = "idle" | "walk" | "run" | "death" | "punch" | "gunIdle" | "gunShoot" | "swing";
export type ClipMix = { base: { role: ClipRole; weight: number; rate: number }[];
  upper: { role: ClipRole; weight: number } | null; once: ClipRole | null };
export function clipMix(pose: PoseInput, stride: { walkM: number; runM: number }): ClipMix;
```

Idle ↔ walk ↔ run cross-weights from `pose.speed` (thresholds matching `characterPose.ts`'s walk/run), playback rate matched so feet do not slide (clip stride length measured from the probe or tuned by eye); aiming with a gun → upper-body `gunIdle` (use an upper-body mask: tracks of spine/arms/head bones only) and `gunShoot` on a fresh recoil; fists/bat on a fresh recoil → `punch`/`swing` once; dead → `death` once, clamped at the last frame.
- [ ] Tests: speed 0 → idle only; walking speed → walk dominant with a rate that grows with speed; running → run; dead → death only and `once`; aiming pistol → upper `gunIdle`; recoil 1 with a pistol → `gunShoot` once; recoil with fists → punch.
- [ ] Commit `feat(arena): map poses onto the characters' animation clips`.

### Task 4: The glTF character

**Files:** create `render3d/characterAssets.ts`, `render3d/gltfCharacter.ts` (+ tests).

- `characterAssets.ts`: `loadCharacterAssets(fetchImpl?): Promise<CharacterAssets>` (manifest → GLBs via `GLTFLoader.parseAsync`), memoised; `characterAssetsReady(): CharacterAssets | null`; `disposeCharacterAssets()` (geometries, materials, textures). Tint by cloning a model's materials once per distinct tint set (cache by key) — never per character.
- `gltfCharacter.ts`: `createGltfCharacter(assets, appearance): Character3d` — `SkeletonUtils.clone` of the model scene, scaled so the character's height matches today's `LOOKS[look].height` × `appearance.scale`, faces local +X like today (rotate the clone to match), one `AnimationMixer` with actions for the rig's clips; `update(pose)` applies `clipMix` with eased weights (crossfade ≈ 0.2 s) and advances the mixer by the frame's dt (take dt from a new optional `PoseInput.dt`? — PoseInput has `tick`; derive dt from tick deltas at 30 Hz, or add `dt` to `PoseInput` in `characterPose.ts` and set it in `entities.ts`/`contacts3d.ts`); weapon via `createWeaponModel` on the right-hand bone (find by name from the probe, e.g. `Hand.R`/`mixamorigRightHand`), oriented so the barrel points along the forearm when aiming; `muzzleWorld` exactly like `characters.ts` (weapon tip → `localToWorld`); dead → death clip and stays down; `dispose` stops the mixer and frees the clone's skeleton (not shared geometry).
- [ ] Tests: build a tiny synthetic "asset" in code (a `SkinnedMesh` with a 3-bone skeleton named like the real hand bone and a 1-track `AnimationClip` per role) — no network — and check: the character faces +X; update with walking speed plays the walk action; a pistol is parented to the hand bone; `muzzleWorld` returns true with a gun and false with fists; death holds the last frame; dispose detaches and stops the mixer.
- [ ] Commit `feat(arena): animated glTF characters`.

### Task 5: Factory, fallback, LOD, performance

**Files:** modify `characters.ts` (`createCharacter` becomes the factory), `entities.ts` (ped appearance id), `contacts3d.ts`, `cast3d.ts`/`index.ts` (kick off loading when the view starts), `sharedAssets.ts`.

- `REAL_ENTITY_FACTORIES.character(look, vestHue)` needs the entity id for peds: extend the factory signature **internally** with an optional `id` (callers in `entities.ts` pass `ped.id`; contacts pass a stable hash of the contact id). A character created before the assets are ready is procedural; when assets become ready, entities re-claim characters on their next sync (bump a "generation" the pool compares, so models swap once, not every frame).
- LOD: at render quality "laag", characters beyond `GLTF_LOD_DISTANCE_M` (≈ 45 m) stay procedural; mixers beyond ≈ 40 m update every other frame (accumulate dt).
- Loading failure → keep procedural for the session; report per the Sentry rules above.
- [ ] Tests: before ready → procedural; after ready → glTF on the next claim; a failed load keeps procedural and reports once; LOD at "laag" keeps far ones procedural; `disposeSharedAssets` frees character assets.
- [ ] Browser check: `/arena/spelen?debug=1`, 3D, third person — the player is the bald man with red sunglasses and mint shorts walking/running smoothly; a crowd of varied peds; cops in police navy; aiming raises the gun; a death lies down. Screenshots `3d-characters-street.jpg`, `3d-characters-player.jpg`. Check FPS stays near today's with ~40 peds in view (`renderer.info.render.calls` / frame time in the console).
- [ ] Commit `feat(arena): swap in the glTF cast with a procedural fallback`.

### Task 6: Docs, verification, PR

- [ ] `docs/tech/arena/3D-MODE.md`: characters section (pipeline, manifest, appearance, animation mapping, fallback/LOD, budget), module map rows, update "Characters and vehicles" table, screenshots; `public/arena/characters/CREDITS.md` complete.
- [ ] Full verification (`tsc`, `lint`, `vitest run`, `build`, `arena:check-characters`), de-slop, push, PR `feat(arena): animated glTF characters with generated looks` against `image`, listing the probe findings and rulings. Do not merge.

## Browser checks

Port **3013** (launch config `h3-immersion-chars`), preview DB, `trainer@example.test` / `preview123`, `/arena/spelen?debug=1`, "Stad verkennen", 3D. Use your **own browser tab** (`tabs_create`) and pass its `tabId` to every call.
