/**
 * Tiny stand-ins for the packed glTF characters, built in code for tests (no network, no files):
 * a model is one skinned triangle on a five-bone skeleton named like the packs' (under an
 * armature scaled ×100, as the packs' is), and a rig's clips each set one lower-body and one
 * upper-body bone to their role's number, so a test can read which clips play from the bones.
 */
import {
  AnimationClip,
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MeshLambertMaterial,
  Skeleton,
  SkinnedMesh,
  Uint8BufferAttribute,
  VectorKeyframeTrack,
} from "three";
import {
  CHARACTER_MODEL_KEYS,
  CLIP_ROLES,
  type CharacterManifest,
  type ClipRole,
} from "../../characterManifest";
import {
  assembleCharacterAssets,
  type CharacterAssets,
  type ParsedGltf,
} from "../characterAssets";

/** The packs' armature scale: bones are authored in hundredths of a metre. */
export const FIXTURE_ARMATURE_SCALE = 100;
/** Palette slots of every fixture model. */
export const FIXTURE_SLOTS = ["Skin", "Head/Skin", "Hair", "Shirt"];
/** Their colours, sRGB. */
const FIXTURE_COLOURS = [0xba9c79, 0xba9c79, 0x412914, 0x223344];
/** The number each role's clip writes into its bones. */
export const ROLE_VALUE: Record<ClipRole, number> = {
  idle: 1,
  walk: 2,
  run: 3,
  death: 4,
  punch: 5,
  gunIdle: 6,
  gunShoot: 7,
  swing: 8,
};
/** How far the death clip carries the hips over its second. */
export const DEATH_END_X = 5;

/** A manifest naming every model and both rigs, all fixture files. */
export function fixtureManifest(): CharacterManifest {
  const models = Object.fromEntries(
    CHARACTER_MODEL_KEYS.map((key) => [
      key,
      {
        file: `${key}.glb`,
        rig: key.includes("woman") ? "women" : "men",
        gender: key.includes("woman") ? "female" : "male",
        materials: FIXTURE_SLOTS,
        colours: FIXTURE_COLOURS,
        height: 1.8,
      },
    ]),
  ) as CharacterManifest["models"];
  const clips = Object.fromEntries(
    CLIP_ROLES.map((role) => [role, role]),
  ) as Record<ClipRole, string>;
  return {
    models,
    animations: {
      men: { file: "anim-men.glb", clips },
      women: { file: "anim-women.glb", clips },
    },
  };
}

/** Root → Hips → Chest → (Head, WristR, WristL), a centimetre apart. */
function fixtureBones(): Bone[] {
  const names = ["Root", "Hips", "Chest", "Head", "WristR", "WristL"];
  const bones = names.map((name) => Object.assign(new Bone(), { name }));
  const [root, hips, chest, head, wristR, wristL] = bones;
  root.add(hips);
  hips.add(chest);
  chest.add(head, wristR, wristL);
  hips.position.set(0, 0.009, 0);
  chest.position.set(0, 0.004, 0);
  head.position.set(0, 0.003, 0);
  wristR.position.set(-0.002, 0.001, 0);
  wristL.position.set(0.002, 0.001, 0);
  return bones;
}

/** One triangle bound to the hips, every vertex in palette slot 3. */
function fixtureGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 0, 0.001, 0, 0, 0, 0.018, 0], 3),
  );
  geometry.setAttribute(
    "skinIndex",
    new Uint8BufferAttribute(new Uint8Array(12).fill(1), 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
  );
  geometry.setAttribute("_palette", new Uint8BufferAttribute([3, 3, 3], 1));
  return geometry;
}

/** A parsed model: the armature and one skinned mesh, as `GLTFLoader` would give it. */
export function fixtureModelGltf(): ParsedGltf {
  const bones = fixtureBones();
  const armature = new Group();
  armature.name = "CharacterArmature";
  armature.scale.setScalar(FIXTURE_ARMATURE_SCALE);
  armature.add(bones[0]);
  const mesh = new SkinnedMesh(fixtureGeometry(), new MeshLambertMaterial());
  mesh.name = "Body";
  mesh.scale.setScalar(FIXTURE_ARMATURE_SCALE);
  const scene = new Group();
  scene.add(armature, mesh);
  scene.updateMatrixWorld(true);
  mesh.bind(new Skeleton(bones));
  return { scene, animations: [] };
}

/** A constant position track on one bone. */
function holdTrack(
  bone: string,
  value: number,
  duration: number,
): VectorKeyframeTrack {
  return new VectorKeyframeTrack(
    `${bone}.position`,
    [0, duration],
    [value, 0, 0, value, 0, 0],
  );
}

/** A rig's clips: each sets the hips and the chest to its role's number; the death slides. */
export function fixtureRigGltf(): ParsedGltf {
  const animations = CLIP_ROLES.map((role) => {
    if (role === "death")
      return new AnimationClip(role, 1, [
        new VectorKeyframeTrack(
          "Hips.position",
          [0, 1],
          [0, 0, 0, DEATH_END_X, 0, 0],
        ),
        holdTrack("Chest", ROLE_VALUE.death, 1),
      ]);
    return new AnimationClip(role, 1, [
      holdTrack("Hips", ROLE_VALUE[role], 1),
      holdTrack("Chest", ROLE_VALUE[role], 1),
    ]);
  });
  return { scene: new Group(), animations };
}

/** Every parsed fixture file the manifest names. */
export function fixtureFiles(
  manifest: CharacterManifest,
): Map<string, ParsedGltf> {
  const files = new Map<string, ParsedGltf>();
  for (const model of Object.values(manifest.models))
    files.set(model.file, fixtureModelGltf());
  for (const rig of Object.values(manifest.animations))
    files.set(rig.file, fixtureRigGltf());
  return files;
}

/** The fixture characters, assembled the way the 3D view assembles the real ones. */
export function fixtureCharacterAssets(): CharacterAssets {
  const manifest = fixtureManifest();
  return assembleCharacterAssets(manifest, fixtureFiles(manifest));
}
