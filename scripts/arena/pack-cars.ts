/**
 * `npm run arena:pack-cars` — packs the owner-approved Kenney Car Kit for the 3D view (spec §8).
 * Downloads the pinned archive into `.cache/arena/cars/` once (sha256-checked), then per vehicle
 * kind turns its Kit model into the game's frame, bakes the colour atlas into vertex colours,
 * splits the body into paint, detail, lamps and light-bar lenses, centres each wheel, and writes
 * `public/arena/cars/<kind>.glb`, `manifest.json` and `CREDITS.md`. `--probe` prints what every
 * model in the Kit holds instead.
 */

import {
  Document,
  GLB_BUFFER,
  NodeIO,
  type Accessor,
  type GLTF,
  type Node,
  type Primitive,
} from "@gltf-transform/core";
import { dedup, getBounds, prune, weld } from "@gltf-transform/functions";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  CAR_ROLES,
  CAR_WHEEL_NODES,
  type CarWheelNode,
} from "../../src/lib/cityArena/carManifest";
import type { Atlas } from "./carAtlas";
import { concatSoups, type Coloured, type Soup } from "./carGeometry";
import { isMissing, writeAtomic } from "./files";
import {
  CAR_OUT_DIR,
  CAR_SOURCES,
  COLORMAP_URI,
  buildCarManifest,
  carCredits,
  carFile,
  carKitFiles,
  fetchCarKit,
  packCarGeometry,
  splitGlb,
  type CarModelSoups,
  type PackedCar,
} from "./packCars";
import type { SourceIo } from "./packCharacters";

/** Digits the probe prints of a length. */
const PROBE_DECIMALS = 3;
/** One kibibyte, for the report. */
const KIB = 1024;
/** Floats per position and per UV. */
const XYZ = 3;
const UV = 2;

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

/** Reads a Kit model, handing gltf-transform the atlas it points at. */
async function readModel(
  io: NodeIO,
  bytes: Uint8Array,
  colormap: Uint8Array,
): Promise<Document> {
  const { json, bin } = splitGlb(bytes);
  // gltf-transform takes resources backed by a plain ArrayBuffer; a copy is one.
  return io.readJSON({
    json: json as GLTF.IGLTF,
    resources: { [GLB_BUFFER]: bin.slice(), [COLORMAP_URI]: colormap.slice() },
  });
}

/** Decodes the atlas to RGBA pixels. */
async function decodeAtlas(png: Uint8Array): Promise<Atlas> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
}

/** Rows (and columns) of a 4 × 4 matrix, stored column by column. */
const MAT4_SIZE = 4;
/** Where a column-major 4 × 4 matrix keeps its translation. */
const MAT4_TRANSLATION = 12;

/** A point moved by a column-major 4 × 4 matrix. */
function transformPoint(
  matrix: readonly number[],
  point: readonly number[],
): number[] {
  return [0, 1, 2].map(
    (row) =>
      matrix[row] * point[0] +
      matrix[row + MAT4_SIZE] * point[1] +
      matrix[row + 2 * MAT4_SIZE] * point[2] +
      matrix[row + MAT4_TRANSLATION],
  );
}

/** A node's triangles in the model's frame (its world transform applied), unindexed. */
function nodeSoup(node: Node): Soup {
  const soup: Soup = { positions: [], uvs: [] };
  const matrix = node.getWorldMatrix();
  for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
    const positions = primitive.getAttribute("POSITION");
    const uvs = primitive.getAttribute("TEXCOORD_0");
    const indices = primitive.getIndices();
    if (!positions || !uvs || !indices) continue;
    for (let index = 0; index < indices.getCount(); index += 1) {
      const vertex = indices.getScalar(index);
      soup.positions.push(
        ...transformPoint(matrix, positions.getElement(vertex, [0, 0, 0])),
      );
      soup.uvs.push(...uvs.getElement(vertex, [0, 0]).slice(0, UV));
    }
  }
  return soup;
}

/** Every node with a mesh, depth first. */
function meshNodes(document: Document): Node[] {
  return document
    .getRoot()
    .listNodes()
    .filter((node) => node.getMesh() !== null);
}

/** A model's body (every node but the wheels) and its wheels, as triangles in the Kit's frame. */
function modelSoups(document: Document, model: string): CarModelSoups {
  const isWheel = (name: string): name is CarWheelNode =>
    (CAR_WHEEL_NODES as readonly string[]).includes(name);
  const nodes = meshNodes(document);
  const wheels = nodes.flatMap((node) => {
    const name = node.getName();
    return isWheel(name) ? [{ node: name, soup: nodeSoup(node) }] : [];
  });
  if (wheels.length !== CAR_WHEEL_NODES.length)
    throw new Error(`${model}: ${wheels.length} wheels`);
  const bodies = nodes.filter((node) => !isWheel(node.getName())).map(nodeSoup);
  return { body: concatSoups(bodies), wheels };
}

/** A primitive of coloured triangles, unindexed (weld indexes it). */
function primitiveOf(
  document: Document,
  triangles: Coloured,
  material: string,
): Primitive {
  const buffer = document.getRoot().listBuffers()[0];
  const attribute = (values: number[]): Accessor =>
    document
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array(values))
      .setBuffer(buffer);
  const found = document
    .getRoot()
    .listMaterials()
    .find((candidate) => candidate.getName() === material);
  return document
    .createPrimitive()
    .setAttribute("POSITION", attribute(triangles.positions))
    .setAttribute("COLOR_0", attribute(triangles.colours))
    .setMaterial(found ?? document.createMaterial(material));
}

/** The packed car as a new document: the body's roles as primitives, each wheel a node. */
function carDocument(car: PackedCar): Document {
  const document = new Document();
  document.createBuffer();
  const scene = document.createScene(car.source.kind);
  const body = document.createMesh("body");
  for (const role of CAR_ROLES)
    if (car.roles[role].positions.length > 0)
      body.addPrimitive(primitiveOf(document, car.roles[role], role));
  scene.addChild(document.createNode("body").setMesh(body));
  for (const wheel of car.wheels) {
    const mesh = document
      .createMesh(wheel.entry.node)
      .addPrimitive(primitiveOf(document, wheel.geometry, "detail"));
    scene.addChild(
      document
        .createNode(wheel.entry.node)
        .setTranslation(wheel.entry.at)
        .setMesh(mesh),
    );
  }
  return document;
}

/** Packs one kind and writes its file; returns the car and the file's size. */
async function packCar(
  io: NodeIO,
  kit: ReturnType<typeof carKitFiles>,
  atlas: Atlas,
  source: (typeof CAR_SOURCES)[number],
): Promise<{ car: PackedCar; bytes: number }> {
  const model = kit.models.find((entry) => entry.name === source.model);
  if (!model) throw new Error(`the Kit has no ${source.model}`);
  const soups = modelSoups(
    await readModel(io, model.bytes, kit.colormap),
    source.model,
  );
  const car = packCarGeometry(soups, source, atlas);
  const document = carDocument(car);
  await document.transform(weld(), dedup(), prune());
  const bytes = await io.writeBinary(document);
  await writeAtomic(path.join(CAR_OUT_DIR, carFile(source.kind)), bytes);
  return { car, bytes: bytes.length };
}

/** Packs every kind and writes the manifest and the credits. */
async function pack(io: NodeIO, archive: Uint8Array): Promise<void> {
  const kit = carKitFiles(archive);
  const atlas = await decodeAtlas(kit.colormap);
  const cars: PackedCar[] = [];
  let total = 0;
  for (const source of CAR_SOURCES) {
    const { car, bytes } = await packCar(io, kit, atlas, source);
    cars.push(car);
    total += bytes;
    console.log(`${carFile(source.kind)}: ${Math.round(bytes / KIB)} KB`);
  }
  await writeAtomic(
    path.join(CAR_OUT_DIR, "manifest.json"),
    `${JSON.stringify(buildCarManifest(cars), null, 2)}\n`,
  );
  await writeAtomic(
    path.join(CAR_OUT_DIR, "CREDITS.md"),
    carCredits(CAR_SOURCES),
  );
  console.log(`total ${Math.round(total / KIB)} KB`);
}

/** A vector for the probe. */
function fixed(values: readonly number[]): string {
  return values.map((value) => value.toFixed(PROBE_DECIMALS)).join(" ");
}

/** Prints a node and its children, indented. */
function probeNode(node: Node, depth: number): void {
  const mesh = node.getMesh();
  const primitives = mesh?.listPrimitives() ?? [];
  const triangles = primitives.reduce(
    (sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? 0) / XYZ,
    0,
  );
  const materials = primitives
    .map((primitive) => primitive.getMaterial()?.getName() ?? "-")
    .join(",");
  console.log(
    `${"  ".repeat(depth)}node ${node.getName()} t=[${fixed(node.getTranslation())}]` +
      (mesh
        ? ` mesh=${mesh.getName()} tris=${triangles} mat=${materials}`
        : ""),
  );
  for (const child of node.listChildren()) probeNode(child, depth + 1);
}

/** Prints what one model holds: nodes (the wheels are separate ones), materials, textures, bounds. */
function probe(document: Document, name: string): void {
  const root = document.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const { min, max } = getBounds(scene);
  const wheels = root
    .listNodes()
    .filter((node) => node.getName().startsWith("wheel-")).length;
  console.log(
    `== ${name} bounds min=[${fixed(min)}] max=[${fixed(max)}] wheel nodes=${wheels}`,
  );
  for (const node of scene.listChildren()) probeNode(node, 1);
  for (const material of root.listMaterials())
    console.log(
      `  material ${material.getName()} base=[${fixed(material.getBaseColorFactor())}] texture=${material.getBaseColorTexture()?.getURI() ?? "-"}`,
    );
  for (const texture of root.listTextures())
    console.log(
      `  texture ${texture.getName()} ${texture.getMimeType()} ${texture.getSize()?.join("x")}`,
    );
}

/** Downloads (once), then probes or packs. */
async function main(): Promise<void> {
  const archive = await fetchCarKit(NODE_SOURCE_IO);
  const io = new NodeIO();
  if (!process.argv.includes("--probe")) {
    await pack(io, archive.bytes);
    return;
  }
  const kit = carKitFiles(archive.bytes);
  for (const model of kit.models)
    probe(await readModel(io, model.bytes, kit.colormap), model.name);
}

if (process.argv[1] && path.basename(process.argv[1]) === "pack-cars.ts")
  void main();
