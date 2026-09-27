/**
 * `npm run arena:pack-characters` — packs the owner-approved Quaternius characters for the 3D view
 * (spec §7). Downloads each pinned GLB into `.cache/arena/characters/` once (sha256-checked), then
 * per model keeps the skinned mesh, merges every material into one palette-slotted primitive and
 * quantises it; per rig (men, women) keeps the animations the game plays from one source, without
 * the channels that only hold the rest pose. Writes `public/arena/characters/*.glb`,
 * `manifest.json` and `CREDITS.md`. `--probe` prints what each source holds instead.
 */

import {
  Document,
  NodeIO,
  type Animation,
  type Node,
  type Primitive,
} from "@gltf-transform/core";
import {
  dedup,
  getBounds,
  joinPrimitives,
  prune,
  resample,
  weld,
} from "@gltf-transform/functions";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PALETTE_ATTRIBUTE,
  PALETTE_SLOTS,
  type CharacterRig,
} from "../../src/lib/cityArena/characterManifest";
import { isMissing, writeAtomic } from "./files";
import {
  CHARACTER_OUT_DIR,
  CHARACTER_SOURCES,
  RIG_ANIMATION_SOURCES,
  animationFile,
  buildManifest,
  characterCredits,
  clipRolesFrom,
  fetchSource,
  isRestChannel,
  modelFile,
  partOfMesh,
  shortClipName,
  slotName,
  srgbHexOf,
  unormWeights,
  type FetchedSource,
  type PackedModel,
  type PackedRig,
  type SourceIo,
} from "./packCharacters";

/**
 * The attributes a packed model keeps. UVs and vertex colours go (the models have no textures),
 * and so do the normals: without them the vertices weld to a quarter, and the 3D view rebuilds
 * creased normals once per model when it loads them.
 */
const KEPT_ATTRIBUTES: ReadonlySet<string> = new Set([
  "POSITION",
  "JOINTS_0",
  "WEIGHTS_0",
]);
/** Meshes that are props, not the person (the hooded adventurer's sword). */
const PROP_MESHES: ReadonlySet<string> = new Set(["Sword"]);
/** The one material every packed model draws with; the palette colours it. */
const PACKED_MATERIAL = "Character";
/** Up is the second axis in glTF. */
const UP_AXIS = 1;
/** One kibibyte, for the report. */
const KIB = 1024;

/** File and network access for the download. */
const NODE_SOURCE_IO: SourceIo = {
  async read(file) {
    try {
      return new Uint8Array(await readFile(file));
    } catch (error: unknown) {
      if (isMissing(error)) return null;
      throw error;
    }
  },
  async write(file, bytes) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  },
  async fetch(url) {
    const response = await fetch(url);
    return {
      ok: response.ok,
      status: response.status,
      bytes: async () => new Uint8Array(await response.arrayBuffer()),
    };
  },
};

/** The nodes of a document that carry a mesh. */
function meshNodes(document: Document): Node[] {
  return document
    .getRoot()
    .listNodes()
    .filter((node) => node.getMesh() !== null);
}

/** Drops an animation with its channels and samplers, so `prune` can free their data. */
function disposeAnimation(animation: Animation): void {
  for (const channel of animation.listChannels()) channel.dispose();
  for (const sampler of animation.listSamplers()) sampler.dispose();
  animation.dispose();
}

/** Drops every animation (a model plays its rig's shared set). */
function stripAnimations(document: Document): void {
  document.getRoot().listAnimations().forEach(disposeAnimation);
}

/** Drops the prop meshes. */
function stripProps(document: Document): void {
  for (const node of meshNodes(document))
    if (PROP_MESHES.has(node.getMesh()?.getName() ?? "")) node.dispose();
}

/** A palette under construction: slot names and their base colours. */
type Palette = { materials: string[]; colours: number[] };

/** A primitive with the body part (mesh) it belongs to. */
type PartPrimitive = { part: string; primitive: Primitive };

/** The name of a primitive's material. */
function materialName(primitive: Primitive): string {
  return primitive.getMaterial()?.getName() || "Default";
}

/** The slot a slot name takes, added to the palette on first sight. */
function slotOf(palette: Palette, name: string, primitive: Primitive): number {
  const known = palette.materials.indexOf(name);
  if (known >= 0) return known;
  palette.materials.push(name);
  palette.colours.push(
    srgbHexOf(primitive.getMaterial()?.getBaseColorFactor() ?? [1, 1, 1]),
  );
  if (palette.materials.length > PALETTE_SLOTS)
    throw new Error(`more than ${PALETTE_SLOTS} palette slots`);
  return palette.materials.length - 1;
}

/** Every primitive of every mesh node, with its part. */
function partPrimitives(nodes: readonly Node[]): PartPrimitive[] {
  return nodes.flatMap((node) => {
    const mesh = node.getMesh();
    const part = partOfMesh(mesh?.getName() ?? "");
    return (mesh?.listPrimitives() ?? []).map((primitive) => ({
      part,
      primitive,
    }));
  });
}

/** The parts each material colours. */
function partsByMaterial(
  primitives: readonly PartPrimitive[],
): Map<string, Set<string>> {
  const parts = new Map<string, Set<string>>();
  for (const { part, primitive } of primitives) {
    const name = materialName(primitive);
    parts.set(name, (parts.get(name) ?? new Set()).add(part));
  }
  return parts;
}

/**
 * Joint indices as bytes (the rig has 62 bones) and weights as normalised bytes: both core glTF,
 * a quarter of the floats' size.
 */
function narrowSkin(primitive: Primitive): void {
  const joints = primitive.getAttribute("JOINTS_0");
  const jointArray = joints?.getArray();
  if (joints && jointArray) joints.setArray(Uint8Array.from(jointArray));
  const weights = primitive.getAttribute("WEIGHTS_0");
  const weightArray = weights?.getArray();
  if (weights && weightArray)
    weights.setArray(unormWeights(weightArray)).setNormalized(true);
}

/** Tags a primitive's vertices with their slot and trims it to the kept attributes. */
function tagPrimitive(
  document: Document,
  primitive: Primitive,
  slot: number,
): void {
  for (const semantic of primitive.listSemantics())
    if (!KEPT_ATTRIBUTES.has(semantic)) primitive.setAttribute(semantic, null);
  const count = primitive.getAttribute("POSITION")?.getCount() ?? 0;
  narrowSkin(primitive);
  const slots = document
    .createAccessor()
    .setType("SCALAR")
    .setArray(new Uint8Array(count).fill(slot))
    .setBuffer(document.getRoot().listBuffers()[0]);
  primitive.setAttribute(PALETTE_ATTRIBUTE, slots);
}

/**
 * Joins every primitive of every mesh into one, on the first mesh node: all four body parts share
 * one skeleton, so one skinned mesh and one draw call suffice. The other mesh nodes go.
 */
function mergeIntoOnePrimitive(document: Document): Palette {
  const palette: Palette = { materials: [], colours: [] };
  const material = document
    .createMaterial(PACKED_MATERIAL)
    .setBaseColorFactor([1, 1, 1, 1])
    .setMetallicFactor(0)
    .setRoughnessFactor(1);
  const nodes = meshNodes(document);
  const primitives = partPrimitives(nodes);
  const parts = partsByMaterial(primitives);
  for (const { part, primitive } of primitives) {
    const name = materialName(primitive);
    const slot = slotName(name, part, parts.get(name) ?? new Set());
    tagPrimitive(document, primitive, slotOf(palette, slot, primitive));
    primitive.setMaterial(material);
  }
  const joined = joinPrimitives(primitives.map(({ primitive }) => primitive));
  for (const { primitive } of primitives) primitive.dispose();
  nodes[0].getMesh()?.addPrimitive(joined);
  for (const node of nodes.slice(1)) node.dispose();
  return palette;
}

/** Standing height of the bind pose. */
function bindHeight(document: Document): number {
  const scene = document.getRoot().getDefaultScene();
  if (!scene) throw new Error("no scene");
  const { min, max } = getBounds(scene);
  return max[UP_AXIS] - min[UP_AXIS];
}

/** Packs one model and writes its file. */
async function packModel(
  io: NodeIO,
  fetched: FetchedSource,
  outDir: string,
): Promise<PackedModel> {
  const document = await io.readBinary(fetched.bytes);
  stripAnimations(document);
  stripProps(document);
  const palette = mergeIntoOnePrimitive(document);
  const height = bindHeight(document);
  await document.transform(
    prune({ keepLeaves: true, keepAttributes: true }),
    weld(),
    dedup(),
  );
  const bytes = await io.writeBinary(document);
  await writeAtomic(path.join(outDir, modelFile(fetched.entry.key)), bytes);
  return { entry: fetched.entry, ...palette, height, bytes: bytes.length };
}

/** The rest value of a node for an animated path. */
function restOf(node: Node, targetPath: string): readonly number[] | null {
  if (targetPath === "translation") return node.getTranslation();
  if (targetPath === "rotation") return node.getRotation();
  if (targetPath === "scale") return node.getScale();
  return null;
}

/** Drops the channels that only ever hold their node's rest value. */
function stripRestChannels(document: Document): number {
  let dropped = 0;
  for (const animation of document.getRoot().listAnimations())
    for (const channel of animation.listChannels()) {
      const node = channel.getTargetNode();
      const rest = node ? restOf(node, channel.getTargetPath() ?? "") : null;
      const values = channel.getSampler()?.getOutput()?.getArray();
      if (!rest || !values || !isRestChannel(values, rest)) continue;
      channel.getSampler()?.dispose();
      channel.dispose();
      dropped += 1;
    }
  return dropped;
}

/** Keeps the animations playing a role, renamed to their short names; drops the rest. */
function keepRoleClips(document: Document): PackedRig["clips"] {
  const animations = document.getRoot().listAnimations();
  const clips = clipRolesFrom(animations.map((clip) => clip.getName()));
  const wanted = new Set(Object.values(clips));
  for (const animation of animations) {
    const name = shortClipName(animation.getName());
    if (wanted.has(name)) animation.setName(name);
    else disposeAnimation(animation);
  }
  return clips;
}

/** Packs one rig's animations from its source and writes the file. */
async function packRig(
  io: NodeIO,
  rig: CharacterRig,
  fetched: FetchedSource,
  outDir: string,
): Promise<PackedRig> {
  const document = await io.readBinary(fetched.bytes);
  for (const node of meshNodes(document)) node.dispose();
  const clips = keepRoleClips(document);
  const dropped = stripRestChannels(document);
  await document.transform(resample(), prune({ keepLeaves: true }), dedup());
  const bytes = await io.writeBinary(document);
  await writeAtomic(path.join(outDir, animationFile(rig)), bytes);
  console.log(`${rig}: dropped ${dropped} rest-pose channels`);
  return { rig, clips, bytes: bytes.length };
}

/** Every source, downloaded or from the cache. */
async function fetchAll(): Promise<FetchedSource[]> {
  const fetched: FetchedSource[] = [];
  for (const entry of CHARACTER_SOURCES)
    fetched.push(await fetchSource(entry, NODE_SOURCE_IO));
  return fetched;
}

/** Packs everything and writes the manifest and the credits. */
async function pack(io: NodeIO, fetched: FetchedSource[]): Promise<void> {
  const outDir = CHARACTER_OUT_DIR;
  const models: PackedModel[] = [];
  for (const source of fetched)
    models.push(await packModel(io, source, outDir));
  const rigs: PackedRig[] = [];
  for (const [rig, key] of Object.entries(RIG_ANIMATION_SOURCES)) {
    const source = fetched.find((candidate) => candidate.entry.key === key);
    if (!source) throw new Error(`no source ${key}`);
    rigs.push(await packRig(io, rig as CharacterRig, source, outDir));
  }
  const manifest = buildManifest(models, rigs);
  await writeAtomic(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeAtomic(
    path.join(outDir, "CREDITS.md"),
    characterCredits(CHARACTER_SOURCES),
  );
  const total = [...models, ...rigs].reduce((sum, item) => sum + item.bytes, 0);
  for (const item of [...models, ...rigs])
    console.log(
      `${"entry" in item ? item.entry.key : `anim-${item.rig}`}: ${Math.round(item.bytes / KIB)} KB`,
    );
  console.log(`total ${Math.round(total / KIB)} KB`);
}

/** Prints what one source holds: meshes, materials, bones and animations. */
function probe(document: Document, key: string): void {
  const root = document.getRoot();
  console.log(`== ${key}`);
  for (const mesh of root.listMeshes()) {
    const triangles = mesh
      .listPrimitives()
      .reduce(
        (sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? 0) / 3,
        0,
      );
    console.log(`  mesh ${mesh.getName()}: ${triangles} triangles`);
  }
  for (const material of root.listMaterials())
    console.log(
      `  material ${material.getName()} #${srgbHexOf(material.getBaseColorFactor()).toString(16).padStart(6, "0")}`,
    );
  const joints = root.listSkins()[0]?.listJoints() ?? [];
  console.log(
    `  bones (${joints.length}): ${joints.map((joint) => joint.getName()).join(" ")}`,
  );
  for (const animation of root.listAnimations()) {
    const ends = animation
      .listSamplers()
      .map((sampler) => sampler.getInput()?.getMax([0])[0] ?? 0);
    console.log(
      `  clip ${animation.getName()}: ${Math.max(...ends).toFixed(2)} s`,
    );
  }
}

/** Downloads (once), then probes or packs. */
async function main(): Promise<void> {
  const io = new NodeIO();
  const fetched = await fetchAll();
  if (process.argv.includes("--probe")) {
    for (const source of fetched)
      probe(await io.readBinary(source.bytes), source.entry.key);
    return;
  }
  await pack(io, fetched);
}

if (process.argv[1] && path.basename(process.argv[1]) === "pack-characters.ts")
  void main();
