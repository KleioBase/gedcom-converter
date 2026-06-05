import { ConversionError, ParseError } from "./errors/index.js";
import { parseGedcom551 } from "./gedcom551/parser.js";
import { stringifyGedcom551 } from "./gedcom551/serializer.js";
import { parseGedcom7 } from "./gedcom7/parser.js";
import { stringifyGedcom7 } from "./gedcom7/serializer.js";
import { decodeInput } from "./utils/text.js";
import type { DetectedVersion, ParseOptions, ParsedDocument, StringifyOptions, SupportedVersion } from "./types.js";

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
