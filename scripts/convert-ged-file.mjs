import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distEntry = pathToFileURL(resolve(rootDir, "dist", "index.js")).href;

let converter;

try {
  converter = await import(distEntry);
} catch (error) {
  console.error("Unable to load dist/index.js. Run `npm run build` first.");
  throw error;
}

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: npm run convert:file -- <path-to-input.ged>");
  process.exit(1);
}

const absoluteInputPath = resolve(process.cwd(), inputPath);
const input = readFileSync(absoluteInputPath, "utf8");
const detectedVersion = converter.detectGedcomVersion(input);

if (detectedVersion === "unknown") {
  console.error(`Could not detect the GEDCOM version for ${absoluteInputPath}.`);
  process.exit(1);
}

const result = converter.convertGedcom(input, {
  from: detectedVersion,
  to: "5.5.1"
});

const outputDir = resolve(rootDir, ".tmp", "generated");
const sourceName = basename(absoluteInputPath, extname(absoluteInputPath));
const outputPath = resolve(outputDir, `${sourceName}.5.5.1.ged`);

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, result.output, "utf8");

const diagnosticCounts = new Map();
for (const diagnostic of result.diagnostics) {
  diagnosticCounts.set(diagnostic.code, (diagnosticCounts.get(diagnostic.code) ?? 0) + 1);
}

console.log(`Input: ${absoluteInputPath}`);
console.log(`Detected version: ${detectedVersion}`);
console.log(`Output: ${outputPath}`);
console.log(`Diagnostics: ${result.diagnostics.length}`);

if (diagnosticCounts.size > 0) {
  console.log("Diagnostic summary:");

  for (const [code, count] of [...diagnosticCounts.entries()].sort((left, right) => right[1] - left[1])) {
    console.log(`- ${code}: ${count}`);
  }
}
