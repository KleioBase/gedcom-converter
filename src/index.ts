import { ConversionError } from "./errors/index.js";
import { parseGedcom551 } from "./gedcom551/parser.js";
import { stringifyGedcom551 } from "./gedcom551/serializer.js";
import { parseGedcom7 } from "./gedcom7/parser.js";
import { stringifyGedcom7 } from "./gedcom7/serializer.js";
import { decodeInput } from "./utils/text.js";
import type { ParseOptions, ParsedDocument, StringifyOptions, SupportedVersion } from "./types.js";

export { convertGedcom } from "./convert/index.js";
export type {
  ConversionResult,
  ConvertOptions,
  Diagnostic,
  DiagnosticLocation,
  DiagnosticSeverity,
  GedcomNode,
  ParseOptions,
  ParsedDocument,
  ParsedHeader,
  ParsedRecord,
  StringifyOptions,
  SupportedVersion
} from "./types.js";

function extractVersionFromHead(input: string): SupportedVersion | "unknown" {
  const normalized = decodeInput(input);

  if (/(?:^|\r?\n)2 VERS 5\.5\.1(?:\r?\n|$)/.test(normalized)) {
    return "5.5.1";
  }

  if (
    /(?:^|\r?\n)2 VERS 7\.0\.18(?:\r?\n|$)/.test(normalized) ||
    /(?:^|\r?\n)2 VERS 7\.0(?:\.\d+)?(?:\r?\n|$)/.test(normalized)
  ) {
    return "7.0.18";
  }

  return "unknown";
}

export function detectGedcomVersion(input: string | Uint8Array): SupportedVersion | "unknown" {
  return extractVersionFromHead(decodeInput(input));
}

export function parseGedcom(input: string | Uint8Array, options: ParseOptions = {}): ParsedDocument {
  const version = options.version ?? detectGedcomVersion(input);

  if (version === "7.0.18") {
    return parseGedcom7(input);
  }

  if (version === "5.5.1") {
    return parseGedcom551(input);
  }

  throw new ConversionError("Unable to detect GEDCOM version. Pass parseGedcom(..., { version }) explicitly.");
}

export function stringifyGedcom(document: ParsedDocument, options: StringifyOptions): string {
  if (options.version === "7.0.18") {
    return stringifyGedcom7(document);
  }

  if (options.version === "5.5.1") {
    return stringifyGedcom551(document);
  }

  throw new ConversionError(`Unsupported stringify target: ${String(options.version)}`);
}
