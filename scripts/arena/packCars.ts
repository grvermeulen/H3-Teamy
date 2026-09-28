/**
 * The car pack's pure half (spec §8): the owner-approved Kenney Car Kit pinned by URL and sha256,
 * the cache download that refuses an archive whose hash moved, and the models inside it. The CLI
 * (`pack-cars.ts`) does the glTF work; everything here runs without gltf-transform.
 */

import path from "node:path";
import {
  CarManifestSchema,
  type CarEntry,
  type CarKind,
  type CarManifest,
  type CarWheelNode,
} from "../../src/lib/cityArena/carManifest";
import { SWATCH, swatchMiddle, type Atlas, type SwatchKey } from "./carAtlas";
import {
  boundsOf,
  boxSoup,
  concatSoups,
  recentring,
  shiftPositions,
  splitBody,
  toCarFrame,
  type SplitBody,
  type Soup,
} from "./carGeometry";
import {
  lampsOf,
  liveryOf,
  measureWheel,
  plateOf,
  type MeasuredWheel,
} from "./carMeasure";
import { creditsFile } from "./credits";
import { sha256Of, type SourceIo } from "./packCharacters";
import { readZip, type ZipEntry } from "./zip";

export type { ZipEntry };

/** Where the downloaded archive is cached (gitignored). */
export const CAR_CACHE_DIR = path.join(".cache", "arena", "cars");
/** Where the packed output goes. */
export const CAR_OUT_DIR = path.join("public", "arena", "cars");

/** The one archive the owner approved (spec §3), pinned by its sha256 on first download. */
export const CAR_KIT = {
  url: "https://kenney.nl/media/pages/assets/car-kit/1a312ec241-1775131960/kenney_car-kit.zip",
  file: "kenney_car-kit.zip",
  page: "https://kenney.nl/assets/car-kit",
  sha256: "fac7dacac5c7874348cf19729af3ef205f3d366493edaf0a827d93f4fdf3d0c4",
} as const;

/** The archive as downloaded, or read from the cache, and its hash. */
export type FetchedArchive = { bytes: Uint8Array; sha256: string };

/** Throws unless the bytes hash to the pinned value; an unpinned archive passes (first download). */
function verify(bytes: Uint8Array, pinned: string): string {
  const hash = sha256Of(bytes);
  if (pinned !== "" && hash !== pinned)
    throw new Error(
      `${CAR_KIT.file}: sha256 ${hash} does not match the pinned ${pinned}; refusing the file`,
    );
  return hash;
}

/**
 * The Car Kit from the cache, or downloaded into it, verified against its pinned sha256.
 *
 * @param io - File and network access.
 * @param cacheDir - The cache directory.
 * @param pinned - The expected sha256; the kit's own unless a test says otherwise.
 * @returns The archive's bytes and their hash.
 */
export async function fetchCarKit(
  io: SourceIo,
  cacheDir: string = CAR_CACHE_DIR,
  pinned: string = CAR_KIT.sha256,
): Promise<FetchedArchive> {
  const file = path.join(cacheDir, CAR_KIT.file);
  const cached = await io.read(file);
  if (cached) return { bytes: cached, sha256: verify(cached, pinned) };
  const response = await io.fetch(CAR_KIT.url);
  if (!response.ok)
    throw new Error(
      `${CAR_KIT.file}: download failed with HTTP ${response.status}`,
    );
  const bytes = await response.bytes();
  const sha256 = verify(bytes, pinned);
  await io.write(file, bytes);
  return { bytes, sha256 };
}

/** The extension of the binary glTF models in the kit. */
const GLB = ".glb";
/** The kit's GLB models share one colour-atlas texture, outside the files. */
export const COLORMAP_URI = "Textures/colormap.png";
/** Where the GLB models and their texture sit in the archive. */
const GLB_DIR = "Models/GLB format/";

/** The kit's models and the texture they reference. */
export type CarKitFiles = {
  /** Each model's name (`sedan`) and GLB bytes, in archive order. */
  models: ZipEntry[];
  /** The shared colour atlas every model's material samples. */
  colormap: Uint8Array;
};

/**
 * The binary glTF models in the archive, by model name (`sedan` for `Models/GLB format/sedan.glb`),
 * and the colour atlas they reference.
 *
 * @param archive - The archive's bytes.
 * @returns The models and the atlas.
 * @throws When the archive has no atlas beside its GLB models.
 */
export function carKitFiles(archive: Uint8Array): CarKitFiles {
  const entries = readZip(archive).filter((entry) =>
    entry.name.startsWith(GLB_DIR),
  );
  const colormap = entries.find(
    (entry) => entry.name === `${GLB_DIR}${COLORMAP_URI}`,
  );
  if (!colormap) throw new Error(`${CAR_KIT.file}: no ${COLORMAP_URI}`);
  const models = entries
    .filter((entry) => entry.name.toLowerCase().endsWith(GLB))
    .map((entry) => ({
      name: path.posix.basename(entry.name, GLB),
      bytes: entry.bytes,
    }));
  return { models, colormap: colormap.bytes };
}

/** A GLB's magic, its header size, and each chunk's header size and types. */
const GLB_MAGIC = 0x46546c67;
const GLB_HEADER = 12;
const CHUNK_HEADER = 8;
/** Where a chunk header keeps its type, after its length. */
const CHUNK_TYPE_OFFSET = 4;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/**
 * A GLB's two chunks: its JSON and its binary buffer. The kit's models point at an image outside
 * the file, which gltf-transform's `readBinary` refuses; their JSON and buffer are read with the
 * image supplied as a resource instead.
 *
 * @param bytes - The GLB.
 * @returns The parsed JSON and the buffer chunk.
 * @throws When the bytes are not a GLB with a JSON and a binary chunk.
 */
export function splitGlb(bytes: Uint8Array): {
  json: unknown;
  bin: Uint8Array;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("not a GLB");
  const jsonLength = view.getUint32(GLB_HEADER, true);
  if (view.getUint32(GLB_HEADER + CHUNK_TYPE_OFFSET, true) !== CHUNK_JSON)
    throw new Error("GLB without a JSON chunk");
  const jsonStart = GLB_HEADER + CHUNK_HEADER;
  const binHeader = jsonStart + jsonLength;
  if (view.getUint32(binHeader + CHUNK_TYPE_OFFSET, true) !== CHUNK_BIN)
    throw new Error("GLB without a binary chunk");
  const binLength = view.getUint32(binHeader, true);
  const binStart = binHeader + CHUNK_HEADER;
  return {
    json: JSON.parse(
      new TextDecoder().decode(bytes.subarray(jsonStart, binHeader)),
    ),
    bin: bytes.subarray(binStart, binStart + binLength),
  };
}

/** The tractor's rims, yellow as on its 2D sprite. */
const TRACTOR_RIM = 0xe0b52a;
/** Window glass, darker than the Kit's pale blue so the evening town does not light it up. */
export const CAR_GLASS = 0x2a3a4c;

/** A small lamp the pack adds where a Kit model has none: a box in the Kit's frame. */
export type AddedLamp = {
  /** Middle of the box, in the Kit's frame (x left, y up, z forward). */
  at: [number, number, number];
  /** Size across, up and along. */
  size: [number, number, number];
  tail: boolean;
};

/** One vehicle kind and the Kit model it is packed from. */
export type CarSource = {
  kind: CarKind;
  /** The model's name in the Kit. */
  model: string;
  /** Its title, for the credits. */
  title: string;
  /** The swatch its body is painted from, tinted per car in the view. */
  paint: SwatchKey;
  /** Its red and blue roof lamps are the light bar's lenses. */
  lightBar?: boolean;
  /** Measure the flank between the arches for the police livery. */
  livery?: boolean;
  /** Swatches its wheels are drawn in another colour, sRGB hex. */
  wheelRecolour?: Partial<Record<SwatchKey, number>>;
  /** Lamps the Kit model lacks. */
  addedLamps?: readonly AddedLamp[];
};

/** Headlamps on the tractor's bonnet front and tail lamps on its rear, which the Kit omits. */
const TRACTOR_LAMPS: readonly AddedLamp[] = [
  { at: [0.2, 0.9, 1.02], size: [0.12, 0.08, 0.02], tail: false },
  { at: [-0.2, 0.9, 1.02], size: [0.12, 0.08, 0.02], tail: false },
  { at: [0.5, 0.95, -0.89], size: [0.1, 0.07, 0.02], tail: true },
  { at: [-0.5, 0.95, -0.89], size: [0.1, 0.07, 0.02], tail: true },
];

/** Every kind drawn with a Kit model, as the probe found them (see `3D-MODE.md`, "Cars"). */
export const CAR_SOURCES: readonly CarSource[] = [
  {
    kind: "compact",
    model: "hatchback-sports",
    title: "Hatchback Sports",
    paint: SWATCH.greenPaint,
  },
  { kind: "sedan", model: "sedan", title: "Sedan", paint: SWATCH.redPaint },
  {
    kind: "sport",
    model: "sedan-sports",
    title: "Sedan Sports",
    paint: SWATCH.redPaint,
  },
  {
    kind: "police",
    model: "police",
    title: "Police",
    paint: SWATCH.light,
    lightBar: true,
    livery: true,
  },
  { kind: "van", model: "van", title: "Van", paint: SWATCH.bluePaint },
  { kind: "pickup", model: "truck", title: "Truck", paint: SWATCH.greenPaint },
  {
    kind: "tractor",
    model: "tractor",
    title: "Tractor",
    paint: SWATCH.blueGrey,
    wheelRecolour: { [SWATCH.rim]: TRACTOR_RIM },
    addedLamps: TRACTOR_LAMPS,
  },
];

/** A Kit model read into triangles: its body (every node but the wheels) and each wheel. */
export type CarModelSoups = {
  body: Soup;
  wheels: { node: CarWheelNode; soup: Soup }[];
};

/** A packed car: its body's triangles by role, its wheels, and its manifest entry. */
export type PackedCar = {
  source: CarSource;
  roles: SplitBody["roles"];
  wheels: MeasuredWheel[];
  entry: Omit<CarEntry, "file">;
};

/** Every position of a model, body and wheels. */
function allPositions(model: CarModelSoups): number[] {
  return [
    ...model.body.positions,
    ...model.wheels.flatMap((wheel) => wheel.soup.positions),
  ];
}

/** The model in the game's frame, recentred, with the lamps the Kit lacks added. */
function inGameFrame(model: CarModelSoups, source: CarSource): CarModelSoups {
  const added = (source.addedLamps ?? []).map((lamp) =>
    boxSoup(lamp.at, lamp.size, lamp.tail ? SWATCH.redLamp : SWATCH.headLamp),
  );
  const turned: CarModelSoups = {
    body: toCarFrame(concatSoups([model.body, ...added])),
    wheels: model.wheels.map((wheel) => ({
      node: wheel.node,
      soup: toCarFrame(wheel.soup),
    })),
  };
  const shift = recentring(boundsOf(allPositions(turned)));
  shiftPositions(turned.body.positions, shift);
  for (const wheel of turned.wheels)
    shiftPositions(wheel.soup.positions, shift);
  return turned;
}

/** Digits a length keeps in the manifest (a tenth of a millimetre at the Kit's scale). */
const MANIFEST_DECIMALS = 4;

/** Every number in a JSON-like value, rounded for the manifest. */
function roundedDeep<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "number" ? Number(item.toFixed(MANIFEST_DECIMALS)) : item,
    ),
  ) as T;
}

/** The manifest entry of a model measured in the game's frame. */
function entryOf(
  turned: CarModelSoups,
  source: CarSource,
  measured: { split: SplitBody; wheels: MeasuredWheel[]; atlas: Atlas },
): Omit<CarEntry, "file"> {
  const { split, atlas } = measured;
  const bounds = boundsOf(allPositions(turned));
  const wheels = measured.wheels.map((wheel) => wheel.entry);
  const size: [number, number, number] = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ];
  return roundedDeep({
    source: source.model,
    size,
    paint: swatchMiddle(atlas, source.paint),
    wheels,
    lamps: [
      ...lampsOf(split.roles.head, false),
      ...lampsOf(split.roles.tail, true),
    ],
    plates: {
      front: plateOf(split.plates.front, 1),
      rear: plateOf(split.plates.rear, -1),
    },
    livery: source.livery ? liveryOf(split.roles.paint, wheels) : null,
  });
}

/**
 * Packs one Kit model for its kind: turns it into the game's frame, splits the body into roles
 * with baked colours, and measures the wheels, lamps, plates and livery.
 *
 * @param model - The model's triangles, in the Kit's frame.
 * @param source - The kind and its rules.
 * @param atlas - The decoded colour atlas.
 * @returns The packed car.
 */
export function packCarGeometry(
  model: CarModelSoups,
  source: CarSource,
  atlas: Atlas,
): PackedCar {
  const turned = inGameFrame(model, source);
  const rules = {
    paint: source.paint,
    recolour: { [SWATCH.glass]: CAR_GLASS },
    lightBar: source.lightBar ?? false,
  };
  const body = boundsOf(turned.body.positions);
  const split = splitBody(turned.body, rules, body, atlas);
  const wheels = turned.wheels.map((wheel) =>
    measureWheel(wheel.node, wheel.soup, {
      atlas,
      recolour: source.wheelRecolour ?? {},
    }),
  );
  const entry = entryOf(turned, source, { split, wheels, atlas });
  return { source, roles: split.roles, wheels, entry };
}

/**
 * The file a kind is packed into.
 *
 * @param kind - The vehicle kind.
 * @returns Its file name under {@link CAR_OUT_DIR}.
 */
export function carFile(kind: CarKind): string {
  return `${kind}.glb`;
}

/**
 * The manifest for what the pack wrote, validated against the schema the 3D view reads.
 *
 * @param cars - Every packed car.
 * @returns The manifest.
 */
export function buildCarManifest(cars: readonly PackedCar[]): CarManifest {
  return CarManifestSchema.parse({
    cars: Object.fromEntries(
      cars.map((car) => [
        car.source.kind,
        { file: carFile(car.source.kind), ...car.entry },
      ]),
    ),
  });
}

/** Where the Kit is credited. */
const KIT_NAME = "Kenney Car Kit 3.1";
/** Its author. */
const KIT_AUTHOR = "Kenney (www.kenney.nl)";
/** Its licence's deed. */
const CC0_LINK =
  "[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)";

/**
 * `public/arena/cars/CREDITS.md`: one row per packed file.
 *
 * @param sources - Every source, in table order.
 * @returns The file contents.
 */
export function carCredits(sources: readonly CarSource[]): string {
  const rows = sources.map(
    (source) =>
      `| ${carFile(source.kind)} | ${source.title} (${KIT_NAME}: ${source.model}) | ${KIT_AUTHOR} | ${CC0_LINK} | ${CAR_KIT.page} |`,
  );
  return creditsFile(
    "Car credits",
    "Every file under `public/arena/cars/`, where it came from, and the licence it carries. Modified by `npm run arena:pack-cars`: each model is turned to the game's frame, its colour atlas is baked into vertex colours (window glass darkened, number plates recessed for the Dutch plates the game mounts), its body split into paint, detail, lamps and light-bar lenses, and its wheels centred for spinning; the tractor gains four lamps.",
    rows,
  );
}
