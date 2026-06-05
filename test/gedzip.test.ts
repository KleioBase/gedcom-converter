import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { looksLikeZip, parseGedcomZip } from "../src/index.js";

// GEDZIP (.gdz) input parser. Fixtures are built in-memory with a tiny
// ZIP writer so the reader is exercised independently of the serializer.

interface ZipInput {
  name: string;
  bytes: Uint8Array;
  deflate?: boolean;
  encrypted?: boolean;
}

function u16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function u32(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
}

function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from([...text].map((char) => char.charCodeAt(0)));
}

/** Build a minimal ZIP archive (stored or deflate; CRC left zero — our reader ignores it). */
function makeZip(entries: ZipInput[]): Uint8Array {
  const local: number[] = [];
  const central: number[] = [];
  const offsets: number[] = [];

  for (const entry of entries) {
    const nameBytes = [...asciiBytes(entry.name)];
    const stored = entry.deflate ? new Uint8Array(deflateRawSync(entry.bytes)) : entry.bytes;
    const method = entry.deflate ? 8 : 0;
    const flags = entry.encrypted ? 0x0001 : 0x0000;
    offsets.push(local.length);

    local.push(
      ...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(method),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(stored.length), ...u32(entry.bytes.length),
      ...u16(nameBytes.length), ...u16(0),
      ...nameBytes, ...stored
    );
  }

  const centralStart = local.length;
  let cursor = 0;
  for (const [index, entry] of entries.entries()) {
    const nameBytes = [...asciiBytes(entry.name)];
    const stored = entry.deflate ? new Uint8Array(deflateRawSync(entry.bytes)) : entry.bytes;
    const method = entry.deflate ? 8 : 0;
    const flags = entry.encrypted ? 0x0001 : 0x0000;
    void cursor;

    central.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flags), ...u16(method),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(stored.length), ...u32(entry.bytes.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offsets[index]!),
      ...nameBytes
    );
  }

  const eocd = [
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(central.length), ...u32(centralStart), ...u16(0)
  ];

  return Uint8Array.from([...local, ...central, ...eocd]);
}

const MINIMAL_GED = [
  "0 HEAD",
  "1 GEDC",
  "2 VERS 7.0.18",
  "0 @I1@ INDI",
  "1 NAME Ada /Lovelace/",
  "1 OBJE @O1@",
  "0 @O1@ OBJE",
  "1 FILE media/photo.jpg",
  "2 FORM image/jpeg",
  "0 TRLR",
  ""
].join("\n");

const IMAGE_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe("looksLikeZip", () => {
  it("recognises the PK signature and rejects strings/plain text", () => {
    expect(looksLikeZip(makeZip([{ name: "gedcom.ged", bytes: asciiBytes(MINIMAL_GED) }]))).toBe(true);
    expect(looksLikeZip("0 HEAD\n0 TRLR\n")).toBe(false);
    expect(looksLikeZip(asciiBytes("0 HEAD"))).toBe(false);
  });
});

describe("parseGedcomZip", () => {
  it("parses the dataset and surfaces embedded media bytes (stored)", async () => {
    const zip = makeZip([
      { name: "gedcom.ged", bytes: asciiBytes(MINIMAL_GED) },
      { name: "media/photo.jpg", bytes: IMAGE_BYTES }
    ]);
    const result = await parseGedcomZip(zip);

    expect(result.document.version).toBe("7.0.18");
    expect(result.document.records.map((r) => r.tag)).toContain("INDI");
    expect(result.files.has("media/photo.jpg")).toBe(true);
    expect([...result.files.get("media/photo.jpg")!]).toEqual([...IMAGE_BYTES]);
  });

  it("inflates deflate-compressed entries", async () => {
    const zip = makeZip([
      { name: "gedcom.ged", bytes: asciiBytes(MINIMAL_GED), deflate: true },
      { name: "media/photo.jpg", bytes: IMAGE_BYTES, deflate: true }
    ]);
    const result = await parseGedcomZip(zip);
    expect(result.document.records.map((r) => r.tag)).toContain("INDI");
    expect([...result.files.get("media/photo.jpg")!]).toEqual([...IMAGE_BYTES]);
  });

  it("throws a clear error for an encrypted entry", async () => {
    const zip = makeZip([
      { name: "gedcom.ged", bytes: asciiBytes(MINIMAL_GED) },
      { name: "media/photo.jpg", bytes: IMAGE_BYTES, encrypted: true }
    ]);
    await expect(parseGedcomZip(zip)).rejects.toThrow(/[Ee]ncrypted/);
  });

  it("ignores META-INF metadata with a diagnostic, without failing", async () => {
    const zip = makeZip([
      { name: "gedcom.ged", bytes: asciiBytes(MINIMAL_GED) },
      { name: "META-INF/MANIFEST.MF", bytes: asciiBytes("Manifest-Version: 1.0\n") }
    ]);
    const result = await parseGedcomZip(zip);
    expect(result.files.has("META-INF/MANIFEST.MF")).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "GEDZIP_METADATA_IGNORED")).toBe(true);
  });

  it("throws when the required gedcom.ged dataset is missing", async () => {
    const zip = makeZip([{ name: "media/photo.jpg", bytes: IMAGE_BYTES }]);
    await expect(parseGedcomZip(zip)).rejects.toThrow(/gedcom\.ged/);
  });

  it("rejects non-zip input", async () => {
    await expect(parseGedcomZip(asciiBytes("0 HEAD\n0 TRLR\n"))).rejects.toThrow(/GEDZIP/);
  });
});
