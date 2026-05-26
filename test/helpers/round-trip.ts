import { expect } from "vitest";
import { parseGedcom } from "../../src/index.js";
import type { ParsedDocument, ParsedRecord, SupportedVersion } from "../../src/types.js";

/**
 * Diff tolerance for round-trip text comparison. Only applies the small set of
 * truly cosmetic differences both directions of the converter can introduce:
 *
 * - line endings (CRLF → LF)
 * - blank lines and trailing whitespace
 * - the HEAD block, which is deliberately rewritten by the version-specific
 *   normalisers (SCHMA collection, GEDC version pin, CHAR removal in v7, etc.)
 * - FORM aliasing under FILE — `jpeg/jpg` and `tiff/tif` are spec-equivalent
 * - MEDI casing — 5.5.1 stores lowercase, v7 stores uppercase, both mean the
 *   same enum value
 *
 * It does NOT cover documented semantic asymmetries (TITL → NOTE, UID → REFN,
 * PHRASE → INT, NOTE ↔ SNOTE tag swap, ROLE Father ↔ FATH); those are
 * exercised by per-fixture diagnostic allow-lists in test/round-trip.test.ts.
 */
export function normalizeForDiff(text: string): string {
  const stripped = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();

  // Remove the HEAD block entirely. HEAD content is rewritten by the
  // normalisers and is not part of the record corpus we're round-tripping.
  const lines = stripped.split("\n");
  const firstRecordIndex = lines.findIndex((line, index) => {
    if (index === 0) return false;
    return /^0\s/.test(line);
  });
  const recordLines = firstRecordIndex >= 0 ? lines.slice(firstRecordIndex) : [];

  return recordLines
    .map((line) => normalizeLineForDiff(line))
    .join("\n");
}

function normalizeLineForDiff(line: string): string {
  // `<level> FORM <value>` → alias jpeg/jpg/tiff/tif to canonical form.
  const formMatch = /^(\d+)\s+FORM\s+(.+)$/.exec(line);
  if (formMatch) {
    const value = formMatch[2]!.trim().toLowerCase();
    const aliased = value === "jpeg" ? "jpg" : value === "tiff" ? "tif" : value;
    return `${formMatch[1]} FORM ${aliased}`;
  }

  // `<level> MEDI <value>` → uppercase for case-insensitive comparison.
  const mediMatch = /^(\d+)\s+MEDI\s+(.+)$/.exec(line);
  if (mediMatch) {
    return `${mediMatch[1]} MEDI ${mediMatch[2]!.trim().toUpperCase()}`;
  }

  return line;
}

interface RecordSignature {
  count: number;
  xrefs: string[];
  topLevelTags: string[];
}

/**
 * Build a structural signature: total record count, set of xrefs (with
 * NOTE/SNOTE collapsed to the same canonical tag so the 5.5.1↔v7 promotion
 * doesn't register as data loss), and the sequence of top-level tags.
 */
function buildSignature(document: ParsedDocument): RecordSignature {
  const xrefs: string[] = [];
  const topLevelTags: string[] = [];

  for (const record of document.records) {
    if (record.xref) {
      xrefs.push(record.xref);
    }
    topLevelTags.push(canonicalRecordTag(record));
  }

  xrefs.sort();
  return {
    count: document.records.length,
    xrefs,
    topLevelTags: topLevelTags.slice().sort()
  };
}

function canonicalRecordTag(record: ParsedRecord): string {
  if (record.tag === "SNOTE") return "NOTE";
  return record.tag;
}

/**
 * Assert that the round-tripped GEDCOM carries every record from the original.
 * Subset semantics — the round-trip may *add* records (e.g. a top-level NOTE
 * record that the v7→5.5.1 path generates to hoist content that 5.5.1 can't
 * represent inline) but it must not *drop* any original record. NOTE↔SNOTE
 * tags are collapsed before comparison.
 */
export function expectStructuralEquivalence(
  originalText: string,
  roundTrippedText: string,
  originalVersion: SupportedVersion,
  roundTripVersion: SupportedVersion = originalVersion
): void {
  const original = parseGedcom(originalText, { version: originalVersion });
  const roundTripped = parseGedcom(roundTrippedText, { version: roundTripVersion });

  const originalSig = buildSignature(original);
  const roundSig = buildSignature(roundTripped);

  expect(roundSig.count, "record count (round-trip >= original)").toBeGreaterThanOrEqual(originalSig.count);

  const roundXrefSet = new Set(roundSig.xrefs);
  const missingXrefs = originalSig.xrefs.filter((xref) => !roundXrefSet.has(xref));
  expect(missingXrefs, "round-trip preserves every original xref").toEqual([]);

  const roundTagCounts = countTags(roundSig.topLevelTags);
  const originalTagCounts = countTags(originalSig.topLevelTags);
  const droppedTags: string[] = [];
  for (const [tag, count] of originalTagCounts) {
    const roundCount = roundTagCounts.get(tag) ?? 0;
    if (roundCount < count) {
      droppedTags.push(`${tag} (orig=${count}, round=${roundCount})`);
    }
  }
  expect(droppedTags, "round-trip preserves every original top-level tag count").toEqual([]);
}

function countTags(tags: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tag of tags) {
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}
