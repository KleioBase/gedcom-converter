import { ConversionError, ParseError } from "./errors/index.js";
import { parseGedcom551 } from "./gedcom551/parser.js";
import { stringifyGedcom551 } from "./gedcom551/serializer.js";
import { parseGedcom7 } from "./gedcom7/parser.js";
import { streamGedcom7Records } from "./gedcom7/stream.js";
import { stringifyGedcom7 } from "./gedcom7/serializer.js";
import { decodeInput } from "./utils/text.js";
import type {
  DetectedVersion,
  GedcomRecordStream,
  ParseOptions,
  ParsedDocument,
  StringifyOptions,
  SupportedVersion
} from "./types.js";

export { convertGedcom } from "./convert/index.js";
export { parseGedcomZip, stringifyGedcomZip, looksLikeZip } from "./gedzip/index.js";
export type { StringifyGedcomZipOptions } from "./gedzip/index.js";
export type {
  ConversionResult,
  ConvertOptions,
  DetectedVersion,
  Diagnostic,
  DiagnosticLocation,
  DiagnosticSeverity,
  GedcomLineEnding,
  GedcomNode,
  GedcomRecordStream,
  ParseOptions,
  ParseableVersion,
  ParsedDocument,
  ParsedGedzip,
  ParsedHeader,
  ParsedRecord,
  StringifyOptions,
  SupportedVersion
} from "./types.js";

function extractVersionFromHead(input: string): DetectedVersion {
  const normalized = decodeInput(input).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (/(?:^|\r?\n)2 VERS 5\.5\.1(?:\r?\n|$)/.test(normalized)) {
    return "5.5.1";
  }

  if (/(?:^|\r?\n)2 VERS 5\.5(?:\r?\n|$)/.test(normalized)) {
    return "5.5";
  }

  if (
    /(?:^|\r?\n)2 VERS 7\.0\.18(?:\r?\n|$)/.test(normalized) ||
    /(?:^|\r?\n)2 VERS 7\.0(?:\.\d+)?(?:\r?\n|$)/.test(normalized)
  ) {
    return "7.0.18";
  }

  return "unknown";
}

/**
 * Detect the GEDCOM version of a document from its `HEAD.GEDC.VERS` line.
 *
 * @param input - GEDCOM text, or bytes (decoded by BOM + `1 CHAR`).
 * @returns `"7.0.18"`, `"5.5.1"`, `"5.5"`, or `"unknown"`.
 * @public
 */
export function detectGedcomVersion(input: string | Uint8Array): DetectedVersion {
  return extractVersionFromHead(decodeInput(input));
}

/**
 * Parse GEDCOM text or bytes into a {@link ParsedDocument}. The version is
 * auto-detected unless `options.version` is given.
 *
 * @throws if the version cannot be detected and none is supplied.
 * @public
 */
export function parseGedcom(input: string | Uint8Array, options: ParseOptions = {}): ParsedDocument {
  const version = options.version ?? detectGedcomVersion(input);

  let document: ParsedDocument;

  if (version === "7.0.18") {
    document = parseGedcom7(input);
  } else if (version === "5.5.1" || version === "5.5") {
    document = parseGedcom551(input);
  } else {
    throw new ConversionError("Unable to detect GEDCOM version. Pass parseGedcom(..., { version }) explicitly.");
  }

  if (options.strict) {
    const blocking = document.diagnostics.find((d) => d.severity === "warning" || d.severity === "error");
    if (blocking) {
      throw new ParseError(`Strict parse failed (${blocking.code}): ${blocking.message}`);
    }
  }

  return document;
}

/**
 * Lazily stream a GEDCOM 7 document's top-level records without materializing
 * the whole node tree. HEAD is parsed eagerly and exposed as
 * {@link GedcomRecordStream.header}; TRLR is consumed and never yielded. Each
 * {@link ParsedRecord} is built on demand and becomes GC-eligible once the
 * consumer advances the iterator, so peak heap is roughly the input string plus
 * a single record's subtree rather than the entire document tree.
 *
 * The stream is synchronous, lazy, and single-pass: exactly one record subtree
 * is built per iterator step. The parser performs no I/O. Every top-level record
 * between HEAD and TRLR is yielded — including `_`-prefixed extension records,
 * which {@link parseGedcom} instead segregates into `document.extensions`.
 *
 * The input must be GEDCOM 7. Detect with {@link detectGedcomVersion} and, for
 * 5.5/5.5.1 sources, convert to 7 first with {@link convertGedcom}, then stream
 * the converted string. Malformed lines and shape violations (missing/duplicate
 * HEAD or TRLR) throw as in {@link parseGedcom}; because parsing is lazy, a
 * violation past the header surfaces mid-iteration.
 *
 * @param input - GEDCOM 7 text or bytes.
 * @param options - {@link ParseOptions}; pass `version` to skip re-detection.
 * @throws if the version cannot be detected and none is supplied, or if the
 *   input is GEDCOM 5.5/5.5.1 (convert to 7 first).
 * @public
 */
export function streamGedcomRecords(input: string | Uint8Array, options: ParseOptions = {}): GedcomRecordStream {
  const text = decodeInput(input);
  const version = options.version ?? detectGedcomVersion(text);

  if (version === "unknown") {
    throw new ConversionError(
      "Unable to detect GEDCOM version. Pass streamGedcomRecords(..., { version }) explicitly."
    );
  }

  if (version !== "7.0.18") {
    throw new ConversionError(
      `streamGedcomRecords requires GEDCOM 7 input; received ${version}. Convert with convertGedcom(..., { to: "7.0.18" }) first, then stream the result.`
    );
  }

  return streamGedcom7Records(text);
}

/**
 * Serialize a {@link ParsedDocument} to GEDCOM text for the requested version.
 *
 * @public
 */
export function stringifyGedcom(document: ParsedDocument, options: StringifyOptions): string {
  if (options.version === "7.0.18") {
    return stringifyGedcom7(document, options.lineEnding);
  }

  if (options.version === "5.5.1") {
    return stringifyGedcom551(document, options.lineEnding);
  }

  throw new ConversionError(`Unsupported stringify target: ${String(options.version)}`);
}
