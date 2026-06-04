// Minimal, dependency-light ZIP reader for GEDZIP (.gdz) archives. It parses the
// central directory and inflates entries using Node's built-in `node:zlib`, so
// the package keeps its zero-runtime-dependency footprint. Only the subset of the
// ZIP format that GEDZIP uses is supported: stored (method 0) and deflate
// (method 8) entries, no spanning, no Zip64.

import { ParseError } from "../errors/index.js";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const ENCRYPTED_FLAG = 0x0001;

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

function findEocdOffset(view: DataView): number {
  // The EOCD is at the end, optionally followed by a comment (≤ 0xFFFF bytes).
  const minOffset = Math.max(0, view.byteLength - (0xffff + 22));
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  throw new ParseError("Not a valid ZIP/GEDZIP archive: end-of-central-directory record not found.");
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const zlib = await import("node:zlib");
  return new Uint8Array(zlib.inflateRawSync(bytes));
}

/**
 * Read every entry of a ZIP archive into name → bytes. Throws a {@link ParseError}
 * for encrypted entries or unsupported compression methods.
 */
export async function readZipEntries(input: Uint8Array): Promise<ZipEntry[]> {
  const bytes = input;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocdOffset(view);

  const entryCount = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true); // central directory offset

  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(pointer, true) !== CENTRAL_FILE_SIGNATURE) {
      throw new ParseError("Corrupt ZIP/GEDZIP archive: bad central directory header.");
    }

    const flags = view.getUint16(pointer + 8, true);
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));

    if (flags & ENCRYPTED_FLAG) {
      throw new ParseError(`Encrypted GEDZIP entries are not supported (entry "${name}").`);
    }

    // The data offset lives behind the local header, whose name/extra lengths may
    // differ from the central directory's, so read them from the local header.
    if (view.getUint32(localOffset, true) !== LOCAL_FILE_SIGNATURE) {
      throw new ParseError(`Corrupt ZIP/GEDZIP archive: bad local header for "${name}".`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);

    let data: Uint8Array;
    if (method === 0) {
      data = compressed.slice();
    } else if (method === 8) {
      data = await inflateRaw(compressed);
    } else {
      throw new ParseError(`Unsupported ZIP compression method ${method} for "${name}".`);
    }

    // Directory entries (trailing "/") carry no payload; skip them.
    if (!name.endsWith("/")) {
      entries.push({ name, bytes: data });
    }

    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Cheap magic-byte check: a ZIP/GEDZIP archive begins with the local-file signature `PK\x03\x04`. */
export function looksLikeZip(input: string | Uint8Array): boolean {
  if (typeof input === "string") {
    return false;
  }
  return input.length >= 4 && input[0] === 0x50 && input[1] === 0x4b && input[2] === 0x03 && input[3] === 0x04;
}
