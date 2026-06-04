import { ParseError } from "../errors/index.js";
import { parseGedcom, stringifyGedcom } from "../index.js";
import type { Diagnostic, GedcomNode, ParsedDocument, ParsedGedzip, StringifyOptions } from "../types.js";
import { looksLikeZip, readZipEntries } from "./zip.js";
import { writeZip, type ZipWriteEntry } from "./zip-writer.js";

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

export interface StringifyGedcomZipOptions extends StringifyOptions {
  /** Optional sink that collects warnings (e.g. a referenced local file with no bytes). */
  diagnostics?: Diagnostic[];
}

// Already-compressed media should be stored, not deflated again (spec Ch.4).
const ALREADY_COMPRESSED = /\.(jpe?g|png|gif|webp|heic|mp[34]|m4[av]|mov|avi|mkv|ogg|oga|ogv|zip|gz|7z|pdf)$/i;

/** A local (relative) FilePath references a file bundled in the archive, not a URL. */
function isLocalFilePath(value: string | undefined): value is string {
  return value !== undefined && value.length > 0 && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !value.startsWith("/");
}

function collectLocalFileReferences(node: GedcomNode, into: Set<string>): void {
  if (node.tag === "FILE" && isLocalFilePath(node.value)) {
    into.add(node.value);
  }
  for (const child of node.children) {
    collectLocalFileReferences(child, into);
  }
}

function localFileReferences(document: ParsedDocument): Set<string> {
  const refs = new Set<string>();
  for (const record of document.records) {
    for (const child of record.children) {
      collectLocalFileReferences(child, refs);
    }
  }
  return refs;
}

/**
 * Serialise a document and its bundled media into a GEDZIP (`.gdz`) archive (spec
 * Ch.4). The dataset is written as `gedcom.ged` (deflated); each entry in `files`
 * is added at its path (already-compressed media is stored, not re-deflated). A
 * `GEDZIP_FILE_MISSING` warning is collected for any local FilePath with no bytes;
 * the archive is still produced.
 */
export async function stringifyGedcomZip(
  document: ParsedDocument,
  files: Map<string, Uint8Array>,
  options: StringifyGedcomZipOptions
): Promise<Uint8Array> {
  const gedText = stringifyGedcom(document, options);
  const entries: ZipWriteEntry[] = [
    { name: GEDZIP_DATASET_NAME, bytes: new TextEncoder().encode(gedText), compress: true }
  ];

  for (const [path, bytes] of files) {
    const name = path.replace(/\\/g, "/");
    entries.push({ name, bytes, compress: !ALREADY_COMPRESSED.test(name) });
  }

  if (options.diagnostics) {
    for (const reference of localFileReferences(document)) {
      if (!files.has(reference)) {
        options.diagnostics.push({
          severity: "warning",
          code: "GEDZIP_FILE_MISSING",
          message: `FilePath "${reference}" references a local file that was not provided; the archive omits it.`,
          location: { tag: "FILE" }
        });
      }
    }
  }

  return writeZip(entries);
}
