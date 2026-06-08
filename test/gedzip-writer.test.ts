import { describe, expect, it } from "vitest";
import { parseGedcom, parseGedcomZip, stringifyGedcomZip } from "../src/index.js";
import type { Diagnostic } from "../src/types.js";

// GEDZIP (.gdz) output serializer.

const GED = [
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

const IMAGE = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

describe("stringifyGedcomZip", () => {
  it("round-trips a document and its media through the archive", async () => {
    const document = parseGedcom(GED, { version: "7.0.18" });
    const files = new Map([["media/photo.jpg", IMAGE]]);

    const archive = await stringifyGedcomZip(document, files, { version: "7.0.18" });

    // Valid ZIP magic, and our reader recovers both the dataset and the media.
    expect([...archive.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const parsed = await parseGedcomZip(archive);
    expect(parsed.document.records.map((r) => r.tag)).toContain("INDI");
    expect([...parsed.files.get("media/photo.jpg")!]).toEqual([...IMAGE]);
  });

  it("warns when a referenced local FilePath has no bytes, but still writes the archive", async () => {
    const document = parseGedcom(GED, { version: "7.0.18" });
    const diagnostics: Diagnostic[] = [];

    const archive = await stringifyGedcomZip(document, new Map(), { version: "7.0.18", diagnostics });

    expect(diagnostics.some((d) => d.code === "GEDZIP_FILE_MISSING")).toBe(true);
    const parsed = await parseGedcomZip(archive);
    expect(parsed.document.records.map((r) => r.tag)).toContain("INDI");
  });

  it("does not warn for a URL FilePath (not a bundled local file)", async () => {
    const ged = GED.replace("media/photo.jpg", "https://example.com/photo.jpg");
    const document = parseGedcom(ged, { version: "7.0.18" });
    const diagnostics: Diagnostic[] = [];

    await stringifyGedcomZip(document, new Map(), { version: "7.0.18", diagnostics });
    expect(diagnostics.some((d) => d.code === "GEDZIP_FILE_MISSING")).toBe(false);
  });

  it("writes a multi-MB entry without overflowing the call stack", async () => {
    // Spreading a multi-MB Uint8Array into Array.prototype.push once threw
    // `RangeError: Maximum call stack size exceeded`. A >1 MB entry exercises
    // the chunked write path; tiny fixtures never grow large enough to fail.
    const ged = GED.replace("media/photo.jpg", "media/big.bin");
    const document = parseGedcom(ged, { version: "7.0.18" });
    const big = new Uint8Array(5 * 1024 * 1024);
    for (let i = 0; i < big.length; i += 7) big[i] = i & 0xff; // defeat trivial deflation
    const files = new Map([["media/big.bin", big]]);

    const archive = await stringifyGedcomZip(document, files, { version: "7.0.18" });

    expect([...archive.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const parsed = await parseGedcomZip(archive);
    expect([...parsed.files.get("media/big.bin")!]).toEqual([...big]);
  });
});
