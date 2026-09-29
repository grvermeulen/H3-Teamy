/**
 * A dependency-free reader for the plain zip archives the asset packs ship in: the central
 * directory lists every entry, and each entry's data is stored or deflated (`zlib`'s raw inflate).
 * No zip64, encryption or spanning — an archive that needs them is refused, not misread.
 */

import { inflateRawSync } from "node:zlib";

/** One file in an archive. */
export type ZipEntry = { name: string; bytes: Uint8Array };

/** The end-of-central-directory record's signature, its fixed size and its fields. */
const EOCD_SIGNATURE = 0x06054b50;
const EOCD_SIZE = 22;
const EOCD_ENTRIES = 10;
const EOCD_DIRECTORY_OFFSET = 16;
/** The longest archive comment the record may be followed by. */
const MAX_COMMENT = 0xffff;
/** A central directory header's signature, its fixed size and its fields. */
const CENTRAL_SIGNATURE = 0x02014b50;
const CENTRAL_SIZE = 46;
const CENTRAL_FLAGS = 8;
const CENTRAL_METHOD = 10;
const CENTRAL_COMPRESSED = 20;
const CENTRAL_UNCOMPRESSED = 24;
const CENTRAL_NAME_LENGTH = 28;
const CENTRAL_EXTRA_LENGTH = 30;
const CENTRAL_COMMENT_LENGTH = 32;
const CENTRAL_LOCAL_OFFSET = 42;
/** A local file header's signature, its fixed size and its variable-length fields. */
const LOCAL_SIGNATURE = 0x04034b50;
const LOCAL_SIZE = 30;
const LOCAL_NAME_LENGTH = 26;
const LOCAL_EXTRA_LENGTH = 28;
/** Compression methods: stored, deflated. */
const STORED = 0;
const DEFLATED = 8;
/** The general-purpose flag bit of an encrypted entry. */
const ENCRYPTED_FLAG = 1;
/** Sizes of this value mean the real ones are in a zip64 record. */
const ZIP64_MARKER = 0xffffffff;

/** Where the end-of-central-directory record starts. */
function findEndRecord(view: DataView): number {
  const last = view.byteLength - EOCD_SIZE;
  const first = Math.max(0, last - MAX_COMMENT);
  for (let offset = last; offset >= first; offset -= 1)
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  throw new Error("not a zip archive: no end-of-central-directory record");
}

/** One central directory header, as far as reading its data needs. */
type CentralEntry = {
  name: string;
  method: number;
  compressed: number;
  uncompressed: number;
  localOffset: number;
  /** Where the next header starts. */
  next: number;
};

/** Reads the central directory header at `offset`. */
function centralEntry(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
): CentralEntry {
  if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE)
    throw new Error(`bad central directory header at ${offset}`);
  if (view.getUint16(offset + CENTRAL_FLAGS, true) & ENCRYPTED_FLAG)
    throw new Error("encrypted zip entries are not supported");
  const nameLength = view.getUint16(offset + CENTRAL_NAME_LENGTH, true);
  const extraLength = view.getUint16(offset + CENTRAL_EXTRA_LENGTH, true);
  const commentLength = view.getUint16(offset + CENTRAL_COMMENT_LENGTH, true);
  const nameStart = offset + CENTRAL_SIZE;
  return {
    name: new TextDecoder().decode(
      bytes.subarray(nameStart, nameStart + nameLength),
    ),
    method: view.getUint16(offset + CENTRAL_METHOD, true),
    compressed: view.getUint32(offset + CENTRAL_COMPRESSED, true),
    uncompressed: view.getUint32(offset + CENTRAL_UNCOMPRESSED, true),
    localOffset: view.getUint32(offset + CENTRAL_LOCAL_OFFSET, true),
    next: nameStart + nameLength + extraLength + commentLength,
  };
}

/** The entry's data, inflated when it is deflated. */
function entryData(
  view: DataView,
  bytes: Uint8Array,
  entry: CentralEntry,
): Uint8Array {
  if (entry.compressed === ZIP64_MARKER || entry.localOffset === ZIP64_MARKER)
    throw new Error(`${entry.name}: zip64 entries are not supported`);
  const local = entry.localOffset;
  if (view.getUint32(local, true) !== LOCAL_SIGNATURE)
    throw new Error(`${entry.name}: bad local header`);
  const start =
    local +
    LOCAL_SIZE +
    view.getUint16(local + LOCAL_NAME_LENGTH, true) +
    view.getUint16(local + LOCAL_EXTRA_LENGTH, true);
  const raw = bytes.subarray(start, start + entry.compressed);
  const data =
    entry.method === STORED
      ? raw
      : entry.method === DEFLATED
        ? new Uint8Array(inflateRawSync(raw))
        : null;
  if (!data)
    throw new Error(`${entry.name}: compression method ${entry.method}`);
  if (data.length !== entry.uncompressed)
    throw new Error(
      `${entry.name}: ${data.length} bytes, expected ${entry.uncompressed}`,
    );
  return data;
}

/**
 * Every file in a zip archive (directories left out), in central directory order.
 *
 * @param bytes - The whole archive.
 * @returns Each file's path inside the archive and its contents.
 * @throws For anything but a plain stored/deflated archive.
 */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndRecord(view);
  const count = view.getUint16(end + EOCD_ENTRIES, true);
  let offset = view.getUint32(end + EOCD_DIRECTORY_OFFSET, true);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const entry = centralEntry(view, bytes, offset);
    offset = entry.next;
    if (entry.name.endsWith("/")) continue;
    entries.push({ name: entry.name, bytes: entryData(view, bytes, entry) });
  }
  return entries;
}
