import type { ParsedDocument, ParsedHeader, ParsedRecord } from "../types.js";
import { decodeInput } from "../utils/text.js";
import { parseGedcomTree } from "../utils/lines.js";
import { GEDCOM7_VERSION } from "./schema.js";
import { normalizeGedcom7Node } from "./normalization.js";

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

export function parseGedcom7(input: string | Uint8Array): ParsedDocument {
  const text = decodeInput(input);
  const { roots, diagnostics } = parseGedcomTree(text);
  const normalizedRoots = roots.map(normalizeGedcom7Node);
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
