// diagnostics.ts — group conversion diagnostics by severity and render a report.
//
// Run: tsx examples/diagnostics.ts
import { readFileSync } from "node:fs";
import { convertGedcom } from "../src/index.js";
import type { Diagnostic, DiagnosticSeverity } from "../src/index.js";

// maximal70.ged exercises nearly every v7 structure, so the down-conversion to
// 5.5.1 produces a rich set of diagnostics.
const input = readFileSync(new URL("../fixtures/official/gedcom70/maximal70.ged", import.meta.url), "utf8");
const { diagnostics } = convertGedcom(input, { from: "7.0.18", to: "5.5.1" });

const bySeverity = new Map<DiagnosticSeverity, Diagnostic[]>();
for (const diagnostic of diagnostics) {
  const bucket = bySeverity.get(diagnostic.severity) ?? [];
  bucket.push(diagnostic);
  bySeverity.set(diagnostic.severity, bucket);
}

for (const severity of ["error", "warning", "info"] as const) {
  const bucket = bySeverity.get(severity) ?? [];
  if (bucket.length === 0) {
    continue;
  }
  console.log(`\n${severity.toUpperCase()} (${bucket.length})`);

  // Count occurrences per diagnostic code.
  const counts = new Map<string, number>();
  for (const diagnostic of bucket) {
    counts.set(diagnostic.code, (counts.get(diagnostic.code) ?? 0) + 1);
  }
  for (const [code, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count.toString().padStart(3)}  ${code}`);
  }
}
