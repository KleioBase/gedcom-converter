import { ParseError } from "../errors/index.js";
import { parseGedcom } from "../index.js";
import type { Diagnostic, ParsedGedzip } from "../types.js";
import { looksLikeZip, readZipEntries } from "./zip.js";

export { looksLikeZip } from "./zip.js";

// The dataset entry in a GEDZIP archive is always named `gedcom.ged` (spec Ch.4).
const GEDZIP_DATASET_NAME = "gedcom.ged";

// JAR-style metadata that some tools add; not part of the GEDZIP payload.
function isArchiveMetadata(name: string): boolean {
  return name === "META-INF" || name.startsWith("META-INF/") || name.endsWith("MANIFEST.MF");
}

/**
 * Parse a FamilySearch GEDZIP (`.gdz`) archive (spec Ch.4): unzip it, parse the
 * `gedcom.ged` dataset, and return the remaining local files keyed by their
 * archive path (the FilePath payloads that reference them). Encrypted archives
 * throw; stray `META-INF` entries are ignored with a diagnostic.
 */
export async function parseGedcomZip(input: Uint8Array): Promise<ParsedGedzip> {
  if (!looksLikeZip(input)) {
    throw new ParseError("Input is not a GEDZIP archive (missing PK\\x03\\x04 signature).");
  }

  const diagnostics: Diagnostic[] = [];
  const entries = await readZipEntries(input);

  const datasetEntry = entries.find((entry) => entry.name === GEDZIP_DATASET_NAME);
  if (!datasetEntry) {
    throw new ParseError(`GEDZIP archive does not contain the required "${GEDZIP_DATASET_NAME}" dataset.`);
  }

  const files = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (entry.name === GEDZIP_DATASET_NAME) {
      continue;
    }
    if (isArchiveMetadata(entry.name)) {
      diagnostics.push({
        severity: "warning",
        code: "GEDZIP_METADATA_IGNORED",
        message: `Ignored non-GEDCOM archive entry "${entry.name}".`,
        location: { tag: "GEDZIP" }
      });
      continue;
    }
    files.set(entry.name, entry.bytes);
  }

  const document = parseGedcom(datasetEntry.bytes);

  return {
    document,
    files,
    diagnostics: [...diagnostics, ...document.diagnostics]
  };
}
