export type SupportedVersion = "5.5.1" | "7.0.18";
export type ParseableVersion = "5.5" | SupportedVersion;
export type DetectedVersion = ParseableVersion | "unknown";

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface DiagnosticLocation {
  line?: number;
  recordId?: string;
  tag?: string;
}

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  location?: DiagnosticLocation;
}

export interface GedcomNode {
  level: number;
  tag: string;
  value?: string;
  xref?: string;
  children: GedcomNode[];
  lineNumber?: number;
}

export interface ParsedHeader {
  sourceSystem?: string;
  gedcomVersion?: string;
  characterSet?: string;
  raw: GedcomNode;
}

export interface ParsedRecord {
  tag: string;
  xref?: string;
  value?: string;
  children: GedcomNode[];
}

export interface ParsedDocument {
  version: ParseableVersion;
  header: ParsedHeader;
  records: ParsedRecord[];
  extensions: GedcomNode[];
  diagnostics: Diagnostic[];
}

export interface ConversionStats {
  recordsProcessed: number;
  unsupportedStructures: number;
  preservedExtensions: number;
}

export interface ConversionResult {
  version: SupportedVersion;
  output: string;
  diagnostics: Diagnostic[];
  stats: ConversionStats;
}

export interface ParseOptions {
  version?: ParseableVersion;
}

export interface StringifyOptions {
  version: SupportedVersion;
}

export interface ConvertOptions {
  from: ParseableVersion;
  to: SupportedVersion;
  strict?: boolean;
  preserveUnknown?: boolean;
  preserveHeaderMeta?: boolean;
}
