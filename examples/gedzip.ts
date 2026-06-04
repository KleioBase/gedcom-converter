// gedzip.ts — build a .gdz archive, read it back, list local files, extract one,
// and re-bundle.
//
// Run: tsx examples/gedzip.ts
import { parseGedcom, parseGedcomZip, stringifyGedcomZip } from "../src/index.js";

const ged = [
  "0 HEAD",
  "1 GEDC",
  "2 VERS 7.0.18",
  "0 @I1@ INDI",
  "1 NAME Ada /Lovelace/",
  "1 OBJE @O1@",
  "0 @O1@ OBJE",
  "1 FILE media/portrait.jpg",
  "2 FORM image/jpeg",
  "0 TRLR",
  ""
].join("\n");

const document = parseGedcom(ged, { version: "7.0.18" });
const portrait = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]); // truncated JPEG header

// Bundle the dataset + media into a GEDZIP archive.
const archive = await stringifyGedcomZip(document, new Map([["media/portrait.jpg", portrait]]), {
  version: "7.0.18"
});
console.log(`Wrote a ${archive.length}-byte .gdz archive`);

// Read it back.
const parsed = await parseGedcomZip(archive);
console.log(`Dataset: ${parsed.document.records.length} record(s) as GEDCOM ${parsed.document.version}`);
console.log(`Bundled files: ${[...parsed.files.keys()].join(", ")}`);

// Extract one file.
const bytes = parsed.files.get("media/portrait.jpg");
console.log(`Extracted media/portrait.jpg (${bytes?.length ?? 0} bytes)`);

// Re-bundle (e.g. after editing the document or adding files).
const rebundled = await stringifyGedcomZip(parsed.document, parsed.files, { version: "7.0.18" });
console.log(`Re-bundled into a ${rebundled.length}-byte archive`);
