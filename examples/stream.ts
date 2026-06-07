// stream.ts — read a GEDCOM 7 file one record at a time without holding the
// whole node tree in memory. Reach for this over parseGedcom when a file is
// large enough that retaining every record subtree at once is a problem.
//
// Run: tsx examples/stream.ts
import { readFileSync } from "node:fs";
import { convertGedcom, detectGedcomVersion, streamGedcomRecords } from "../src/index.js";

const path = new URL("../fixtures/official/gedcom70/maximal70.ged", import.meta.url);
let input = readFileSync(path, "utf8");

// streamGedcomRecords is GEDCOM 7 only; convert older inputs up to 7 first, then
// stream the converted string.
const version = detectGedcomVersion(input);
if (version === "5.5" || version === "5.5.1") {
  input = convertGedcom(input, { from: version, to: "7.0.18" }).output;
}

const stream = streamGedcomRecords(input);

// The header is available before iteration begins.
console.log(`Source system: ${stream.header.sourceSystem ?? "(none)"}`);
console.log(`GEDCOM version: ${stream.version}\n`);

const tagCounts = new Map<string, number>();

// Each step builds exactly one record subtree; once the loop body returns, that
// record is eligible for garbage collection before the next is built.
for (const record of stream) {
  tagCounts.set(record.tag, (tagCounts.get(record.tag) ?? 0) + 1);
}

console.log("Top-level records by tag:");
for (const [tag, count] of [...tagCounts].sort()) {
  console.log(`  ${tag}: ${count}`);
}

// Diagnostics are fully populated once the iterator is exhausted.
if (stream.diagnostics.length > 0) {
  console.log(`\n${stream.diagnostics.length} diagnostic(s):`);
  for (const diagnostic of stream.diagnostics) {
    console.log(`  ${diagnostic.severity}: ${diagnostic.code} — ${diagnostic.message}`);
  }
}
