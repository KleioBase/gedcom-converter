// Minimal ZIP writer for GEDZIP (.gdz) output. Produces a standard archive that
// third-party tools (and our own reader) accept: correct CRC-32, local headers,
// central directory and EOCD. Uses Node's built-in `node:zlib` for deflate, so
// the package keeps zero runtime dependencies.

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipWriteEntry {
  name: string;
  bytes: Uint8Array;
  /** Deflate the entry (true) or store it uncompressed (false). */
  compress: boolean;
}

function pushU16(out: number[], value: number): void {
  out.push(value & 0xff, (value >> 8) & 0xff);
}

function pushU32(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const zlib = await import("node:zlib");
  return new Uint8Array(zlib.deflateRawSync(bytes));
}

/** Write a set of entries into a ZIP archive byte stream. Paths use forward slashes. */
export async function writeZip(entries: ZipWriteEntry[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];

  interface Prepared {
    nameBytes: Uint8Array;
    method: number;
    crc: number;
    compressed: Uint8Array;
    uncompressedSize: number;
    offset: number;
  }

  const prepared: Prepared[] = [];

  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, "/");
    const nameBytes = encoder.encode(name);
    const crc = crc32(entry.bytes);
    const compressed = entry.compress ? await deflateRaw(entry.bytes) : entry.bytes;
    const method = entry.compress ? 8 : 0;
    const offset = local.length;

    pushU32(local, 0x04034b50);
    pushU16(local, 20);
    pushU16(local, 0); // flags
    pushU16(local, method);
    pushU16(local, 0); // mod time
    pushU16(local, 0); // mod date
    pushU32(local, crc);
    pushU32(local, compressed.length);
    pushU32(local, entry.bytes.length);
    pushU16(local, nameBytes.length);
    pushU16(local, 0); // extra length
    local.push(...nameBytes, ...compressed);

    prepared.push({ nameBytes, method, crc, compressed, uncompressedSize: entry.bytes.length, offset });
  }

  const centralStart = local.length;
  for (const entry of prepared) {
    pushU32(central, 0x02014b50);
    pushU16(central, 20); // version made by
    pushU16(central, 20); // version needed
    pushU16(central, 0); // flags
    pushU16(central, entry.method);
    pushU16(central, 0); // mod time
    pushU16(central, 0); // mod date
    pushU32(central, entry.crc);
    pushU32(central, entry.compressed.length);
    pushU32(central, entry.uncompressedSize);
    pushU16(central, entry.nameBytes.length);
    pushU16(central, 0); // extra
    pushU16(central, 0); // comment
    pushU16(central, 0); // disk number start
    pushU16(central, 0); // internal attrs
    pushU32(central, 0); // external attrs
    pushU32(central, entry.offset);
    central.push(...entry.nameBytes);
  }

  const eocd: number[] = [];
  pushU32(eocd, 0x06054b50);
  pushU16(eocd, 0); // disk number
  pushU16(eocd, 0); // disk with CD
  pushU16(eocd, prepared.length);
  pushU16(eocd, prepared.length);
  pushU32(eocd, central.length);
  pushU32(eocd, centralStart);
  pushU16(eocd, 0); // comment length

  return Uint8Array.from([...local, ...central, ...eocd]);
}
