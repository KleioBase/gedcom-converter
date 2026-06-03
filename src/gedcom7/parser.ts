import type { ParsedDocument, ParsedHeader, ParsedRecord } from "../types.js";
import { ParseError } from "../errors/index.js";
import { decodeInput } from "../utils/text.js";
import { normalizeContinuationPayloads, parseGedcomTree } from "../utils/lines.js";
import { GEDCOM7_VERSION } from "./schema.js";
import { normalizeGedcom7Node } from "./normalization.js";

const BANNED_GEDCOM7_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F\uD800-\uDFFF\uFFFE\uFFFF]/u;
const GEDCOM7_LINE_PATTERN =
  /^(?:0|[1-9]\d*) (?:(?:@[A-Z0-9_]+@) )?(?:[A-Z][A-Z0-9_]*|_[A-Z0-9_]+)(?: (?:@VOID@|@[A-Z0-9_]+@|@@[^\r\n]*|[^\r\n@][^\r\n]*))?$/u;

function toParsedRecord(node: ParsedRecord & { xref?: string; value?: string }): ParsedRecord {
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

function splitPhysicalLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

function validateGedcom7LineSyntax(text: string): void {
  for (const [index, line] of splitPhysicalLines(text).entries()) {
    const lineNumber = index + 1;

    if (line.length === 0) {
      throw new ParseError(`Invalid blank GEDCOM 7 line at ${lineNumber}.`);
    }

    if (BANNED_GEDCOM7_CHARACTERS.test(line)) {
      throw new ParseError(`Invalid GEDCOM 7 character at line ${lineNumber}.`);
    }

    if (!GEDCOM7_LINE_PATTERN.test(line)) {
      throw new ParseError(`Invalid GEDCOM 7 line at ${lineNumber}: ${line}`);
    }
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
  const sourceSystem = headerNode.children.find((child) => child.tag === "SOUR")?.value;
  const records: ParsedRecord[] = rawRecords
    .filter((node) => !node.tag.startsWith("_"))
    .map((node) => toParsedRecord(node));

  const header: ParsedHeader = {
    gedcomVersion: extractHeaderVersion(headerNode.children) ?? GEDCOM7_VERSION,
    characterSet: headerNode.children.find((child) => child.tag === "CHAR")?.value ?? "UTF-8",
    raw: headerNode,
    ...(sourceSystem !== undefined ? { sourceSystem } : {})
  };

  return {
    version: GEDCOM7_VERSION,
    header,
    records,
    extensions,
    diagnostics
  };
}
