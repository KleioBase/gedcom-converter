import type { Diagnostic, GedcomNode, ParsedDocument, ParsedHeader, ParsedRecord, SupportedVersion } from "../types.js";

export interface IntermediateDocument {
  version: SupportedVersion;
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
