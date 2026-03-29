import type { Diagnostic, GedcomNode, ParseableVersion, ParsedDocument, ParsedHeader, ParsedRecord } from "../types.js";

export interface IntermediateDocument {
  version: ParseableVersion;
  header: ParsedHeader;
  records: ParsedRecord[];
  extensions: GedcomNode[];
  diagnostics: Diagnostic[];
}

export function toIntermediateDocument(document: ParsedDocument): IntermediateDocument {
  return {
    version: document.version,
    header: document.header,
    records: document.records,
    extensions: document.extensions,
    diagnostics: [...document.diagnostics]
  };
}
