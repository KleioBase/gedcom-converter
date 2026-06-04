// convert.ts — convert GEDCOM 7.0 → 5.5.1, handle diagnostics, decide on strict.
//
// Run: tsx examples/convert.ts
import { readFileSync } from "node:fs";
import { ConversionError } from "../src/errors/index.js";
import { convertGedcom, detectGedcomVersion } from "../src/index.js";

const input = readFileSync(new URL("../fixtures/minimal-7.0.18.ged", import.meta.url), "utf8");
const from = detectGedcomVersion(input);
if (from === "unknown") {
  throw new Error("Could not detect the source version");
}

// A non-strict conversion always produces valid output plus diagnostics.
const result = convertGedcom(input, { from, to: "5.5.1" });
console.log(result.output);
console.log(`\nStats: ${result.stats.recordsProcessed} records, ${result.stats.unsupportedStructures} unsupported`);

// Use strict mode in pipelines that must reject any lossy conversion.
const hasWarnings = result.diagnostics.some((d) => d.severity === "warning");
if (hasWarnings) {
  try {
    convertGedcom(input, { from, to: "5.5.1", strict: true });
  } catch (error) {
    if (error instanceof ConversionError) {
      console.log(`\nStrict mode would reject this conversion: ${error.message}`);
    }
  }
} else {
  console.log("\nNo warnings — strict mode would accept this conversion.");
}
