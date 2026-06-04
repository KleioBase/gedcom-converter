// parse.ts — read a .ged file, log diagnostics, and walk its records.
//
// Run: tsx examples/parse.ts
import { readFileSync } from "node:fs";
import { detectGedcomVersion, parseGedcom } from "../src/index.js";

const path = new URL("../fixtures/minimal-7.0.18.ged", import.meta.url);
const input = readFileSync(path, "utf8");

console.log(`Detected version: ${detectGedcomVersion(input)}`);

const document = parseGedcom(input);
console.log(`Parsed ${document.records.length} record(s) as GEDCOM ${document.version}\n`);

for (const record of document.records) {
  const id = record.xref ? `${record.xref} ` : "";
  console.log(`• ${id}${record.tag} (${record.children.length} substructure(s))`);
  for (const child of record.children) {
    console.log(`    ${child.tag}${child.value ? ` = ${child.value}` : ""}`);
  }
}

if (document.diagnostics.length > 0) {
  console.log(`\n${document.diagnostics.length} diagnostic(s):`);
  for (const diagnostic of document.diagnostics) {
    console.log(`  ${diagnostic.severity}: ${diagnostic.code} — ${diagnostic.message}`);
  }
}
