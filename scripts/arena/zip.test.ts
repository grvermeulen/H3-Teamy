import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readZip } from "./zip";

/** One entry to write: its name, contents and whether to deflate it. */
type Entry = { name: string; text: string; deflate?: boolean; method?: number };

/** A little-endian record of the given field widths. */
function record(fields: readonly [number, number][]): Buffer {
  const buffer = Buffer.alloc(
    fields.reduce((sum, [, width]) => sum + width, 0),
  );
  let offset = 0;
  for (const [value, width] of fields) {
    if (width === 2) buffer.writeUInt16LE(value, offset);
    else buffer.writeUInt32LE(value, offset);
    offset += width;
  }
  return buffer;
}

/** Zip record signatures and the version a reader needs. */
const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const VERSION = 20;
/** Compression methods: stored, deflated. */
const STORED = 0;
const DEFLATED = 8;

/** One entry's parts: name, data as stored, method and the fields both headers share. */
type Packed = {
  name: Buffer;
  data: Buffer;
  method: number;
  sizes: [number, number][];
};

/** An entry as a zip tool would store it. */
function packEntry(entry: Entry): Packed {
  const name = Buffer.from(entry.name);
  const raw = Buffer.from(entry.text);
  const data = entry.deflate ? deflateRawSync(raw) : raw;
  const method = entry.method ?? (entry.deflate ? DEFLATED : STORED);
  const sizes: [number, number][] = [
    [0, 4],
    [data.length, 4],
    [raw.length, 4],
    [name.length, 2],
    [0, 2],
  ];
  return { name, data, method, sizes };
}

/** A local file header. */
function localHeader(entry: Packed): Buffer {
  const lead: [number, number][] = [
    [LOCAL, 4],
    [VERSION, 2],
    [0, 2],
  ];
  return record([...lead, [entry.method, 2], [0, 2], [0, 2], ...entry.sizes]);
}

/** A central directory header pointing at a local header. */
function centralHeader(entry: Packed, offset: number): Buffer {
  const lead: [number, number][] = [
    [CENTRAL, 4],
    [VERSION, 2],
    [VERSION, 2],
  ];
  const tail: [number, number][] = [
    [0, 2],
    [0, 2],
    [0, 2],
    [0, 4],
    [offset, 4],
  ];
  const fields = [...lead, [0, 2], [entry.method, 2], [0, 2], [0, 2]];
  return record([...(fields as [number, number][]), ...entry.sizes, ...tail]);
}

/** A plain zip archive holding `entries`, as a zip tool would write it. */
function zipOf(entries: readonly Entry[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries.map(packEntry)) {
    const local = localHeader(entry);
    locals.push(local, entry.name, entry.data);
    centrals.push(centralHeader(entry, offset), entry.name);
    offset += local.length + entry.name.length + entry.data.length;
  }
  const directory = Buffer.concat(centrals);
  const count: [number, number] = [entries.length, 2];
  const end = record([
    [END, 4],
    [0, 2],
    [0, 2],
    count,
    count,
    [directory.length, 4],
    [offset, 4],
    [0, 2],
  ]);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

describe("readZip", () => {
  it("reads stored and deflated files and skips directories", () => {
    const archive = zipOf([
      { name: "Models/", text: "" },
      { name: "Models/a.txt", text: "hoi" },
      { name: "Models/b.txt", text: "dag dag dag dag", deflate: true },
    ]);
    const entries = readZip(archive);
    expect(entries.map((entry) => entry.name)).toEqual([
      "Models/a.txt",
      "Models/b.txt",
    ]);
    expect(new TextDecoder().decode(entries[1].bytes)).toBe("dag dag dag dag");
  });

  it("refuses bytes that are not an archive", () => {
    expect(() => readZip(new Uint8Array(64))).toThrow(/not a zip archive/);
  });

  it("refuses a compression method it cannot read", () => {
    const archive = zipOf([{ name: "c.txt", text: "x", method: 12 }]);
    expect(() => readZip(archive)).toThrow(/compression method 12/);
  });
});
