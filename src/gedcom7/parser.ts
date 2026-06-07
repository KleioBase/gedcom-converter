import type { ParsedDocument, ParsedHeader, ParsedRecord } from "../types.js";
import { ParseError } from "../errors/index.js";
import { decodeInput } from "../utils/text.js";
import { normalizeContinuationPayloads, parseGedcomTree } from "../utils/lines.js";
import { GEDCOM7_VERSION } from "./schema.js";
import { normalizeGedcom7Node } from "./normalization.js";

const BANNED_GEDCOM7_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F\uD800-\uDFFF\uFFFE\uFFFF]/u;
// Spec §1.3: the cross-reference-identifier (Xref) is `@1*tagchar@` but explicitly
// "not @VOID@" — @VOID@ is only valid as a pointer *payload* (the value alternation
// below still allows it). The `(?!VOID@)` lookahead rejects @VOID@ in the xref slot.
const GEDCOM7_LINE_PATTERN =
  /^(?:0|[1-9]\d*) (?:(?:@(?!VOID@)[A-Z0-9_]+@) )?(?:[A-Z][A-Z0-9_]*|_[A-Z0-9_]+)(?: (?:@VOID@|@[A-Z0-9_]+@|@@[^\r\n]*|[^\r\n@][^\r\n]*))?$/u;
// Spec §1.3: CONC is reserved and does not appear as a structure tag in GEDCOM 7
// (continuation uses CONT only). Reject it rather than admit a stray child node.
const GEDCOM7_CONC_LINE = /^(?:0|[1-9]\d*) (?:@[A-Z0-9_]+@ )?CONC(?: |$)/u;

export function toParsedRecord(node: ParsedRecord & { xref?: string; value?: string }): ParsedRecord {
  return {
    tag: node.tag,
    children: node.children,
    ...(node.xref !== undefined ? { xref: node.xref } : {}),
    ...(node.value !== undefined ? { value: node.value } : {})
  };
}

function extractHeaderVersion(headerChildren: ParsedHeader["raw"]["children"]): string | undefined {
  const gedc = headerChildren.find((child) => child.tag === "GEDC");
  return gedc?.children.find((child) => child.tag === "VERS")?.value;
}

/**
 * Build the convenience {@link ParsedHeader} view of a normalized HEAD node.
 * Shared by {@link parseGedcom7} and the record streamer so both expose the
 * same header fields.
 */
export function buildGedcom7Header(headerNode: ParsedHeader["raw"]): ParsedHeader {
  const sourceSystem = headerNode.children.find((child) => child.tag === "SOUR")?.value;

  return {
    gedcomVersion: extractHeaderVersion(headerNode.children) ?? GEDCOM7_VERSION,
    characterSet: headerNode.children.find((child) => child.tag === "CHAR")?.value ?? "UTF-8",
    raw: headerNode,
    ...(sourceSystem !== undefined ? { sourceSystem } : {})
  };
}

function splitPhysicalLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

/**
 * Validate a single physical line against the GEDCOM 7 container grammar,
 * throwing {@link ParseError} on any violation. Shared by the eager parser and
 * the record streamer so both reject the same malformed lines.
 */
export function validateGedcom7Line(line: string, lineNumber: number): void {
  if (line.length === 0) {
    throw new ParseError(`Invalid blank GEDCOM 7 line at ${lineNumber}.`);
  }

  if (BANNED_GEDCOM7_CHARACTERS.test(line)) {
    throw new ParseError(`Invalid GEDCOM 7 character at line ${lineNumber}.`);
  }

  if (GEDCOM7_CONC_LINE.test(line)) {
    throw new ParseError(`CONC is reserved and invalid in GEDCOM 7 (use CONT) at line ${lineNumber}: ${line}`);
  }

  if (!GEDCOM7_LINE_PATTERN.test(line)) {
    throw new ParseError(`Invalid GEDCOM 7 line at ${lineNumber}: ${line}`);
  }
}

function validateGedcom7LineSyntax(text: string): void {
  for (const [index, line] of splitPhysicalLines(text).entries()) {
    validateGedcom7Line(line, index + 1);
  }
}

function validateGedcom7DocumentShape(roots: ParsedHeader["raw"][]): void {
  if (roots[0]?.tag !== "HEAD") {
    throw new ParseError("GEDCOM 7 document must begin with HEAD");
  }

  if (roots[roots.length - 1]?.tag !== "TRLR") {
    throw new ParseError("GEDCOM 7 document must end with TRLR");
  }

  const headCount = roots.filter((node) => node.tag === "HEAD").length;
  const trailerCount = roots.filter((node) => node.tag === "TRLR").length;

  if (headCount !== 1) {
    throw new ParseError("GEDCOM 7 document must contain exactly one HEAD");
  }

  if (trailerCount !== 1) {
    throw new ParseError("GEDCOM 7 document must contain exactly one TRLR");
  }

  const trailer = roots[roots.length - 1];
  if (trailer && (trailer.value !== undefined || trailer.xref !== undefined || trailer.children.length > 0)) {
    throw new ParseError("GEDCOM 7 TRLR must not have a payload, xref, or substructures");
  }
}

export function parseGedcom7(input: string | Uint8Array): ParsedDocument {
  const text = decodeInput(input);
  validateGedcom7LineSyntax(text);
  const { roots, diagnostics } = parseGedcomTree(text);
  validateGedcom7DocumentShape(roots);
  const normalizedRoots = normalizeContinuationPayloads(roots.map(normalizeGedcom7Node), "gedcom7");
  const headerNode = normalizedRoots.find((node) => node.tag === "HEAD");

  if (!headerNode) {
    throw new Error("GEDCOM 7 document is missing HEAD");
  }

  const rawRecords = normalizedRoots.filter((node) => node.tag !== "HEAD" && node.tag !== "TRLR");
  const extensions = rawRecords.filter((node) => node.tag.startsWith("_"));
  const records: ParsedRecord[] = rawRecords
    .filter((node) => !node.tag.startsWith("_"))
    .map((node) => toParsedRecord(node));

  const header = buildGedcom7Header(headerNode);

  return {
    version: GEDCOM7_VERSION,
    header,
    records,
    extensions,
    diagnostics
  };
}
