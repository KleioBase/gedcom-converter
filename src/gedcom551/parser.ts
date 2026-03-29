import type { ParseableVersion, ParsedDocument, ParsedHeader, ParsedRecord } from "../types.js";
import { decodeInput } from "../utils/text.js";
import { normalizeContinuationPayloads, parseGedcomTree } from "../utils/lines.js";
import { GEDCOM551_VERSION } from "./schema.js";
import { normalizeGedcom551Node } from "./normalization.js";

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

export function parseGedcom551(input: string | Uint8Array): ParsedDocument {
  const text = decodeInput(input);
  const { roots, diagnostics } = parseGedcomTree(text);
  const normalizedRoots = normalizeContinuationPayloads(roots.map(normalizeGedcom551Node), "gedcom551");
  const headerNode = normalizedRoots.find((node) => node.tag === "HEAD");

  if (!headerNode) {
    throw new Error("GEDCOM 5.5.1 document is missing HEAD");
  }

  const rawRecords = normalizedRoots.filter((node) => node.tag !== "HEAD" && node.tag !== "TRLR");
  const extensions = rawRecords.filter((node) => node.tag.startsWith("_"));
  const sourceSystem = headerNode.children.find((child) => child.tag === "SOUR")?.value;
  const records: ParsedRecord[] = rawRecords
    .filter((node) => !node.tag.startsWith("_"))
    .map((node) => toParsedRecord(node));

  const parsedVersion = extractHeaderVersion(headerNode.children);
  const documentVersion: ParseableVersion = parsedVersion === "5.5" ? "5.5" : GEDCOM551_VERSION;

  const header: ParsedHeader = {
    gedcomVersion: parsedVersion ?? GEDCOM551_VERSION,
    characterSet: headerNode.children.find((child) => child.tag === "CHAR")?.value ?? "ANSEL",
    raw: headerNode,
    ...(sourceSystem !== undefined ? { sourceSystem } : {})
  };

  return {
    version: documentVersion,
    header,
    records,
    extensions,
    diagnostics
  };
}
