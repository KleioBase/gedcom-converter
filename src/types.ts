/** A GEDCOM version this library can both read and write. */
export type SupportedVersion = "5.5.1" | "7.0.18";
/** A version this library can read (legacy 5.5 is read-only, normalised to 5.5.1). */
export type ParseableVersion = "5.5" | SupportedVersion;
/** Result of {@link DetectedVersion} detection — a parseable version or `"unknown"`. */
export type DetectedVersion = ParseableVersion | "unknown";

/** Severity of a {@link Diagnostic}. `strict` conversion rejects on any `"warning"`. */
export type DiagnosticSeverity = "info" | "warning" | "error";

/** Where a {@link Diagnostic} originated. All fields are best-effort. */
export interface DiagnosticLocation {
  /** 1-based source line number, when known. */
  line?: number;
  /** The xref of the enclosing record, when known. */
  recordId?: string;
  /** The tag of the structure the diagnostic concerns. */
  tag?: string;
}

/** A single parse/conversion observation. `code` is a stable, machine-readable identifier. */
export interface Diagnostic {
  severity: DiagnosticSeverity;
  /** Stable code (see the fidelity matrix); treated as part of the public contract. */
  code: string;
  message: string;
  location?: DiagnosticLocation;
}

/** A node in the GEDCOM tree: a tag with an optional payload and/or xref and its children. */
export interface GedcomNode {
  /** GEDCOM level number (0 for records). */
  level: number;
  tag: string;
  /** Line payload, with CONT/CONC continuations already joined. */
  value?: string;
  /** Cross-reference identifier, e.g. `@I1@`. */
  xref?: string;
  children: GedcomNode[];
  /** 1-based source line number, when available. */
  lineNumber?: number;
}

/** Parsed HEAD record: a few convenience fields plus the raw HEAD node. */
export interface ParsedHeader {
  sourceSystem?: string;
  gedcomVersion?: string;
  characterSet?: string;
  /** The full HEAD structure as parsed. */
  raw: GedcomNode;
}

/** A top-level GEDCOM record (INDI, FAM, SOUR, …). */
export interface ParsedRecord {
  tag: string;
  xref?: string;
  value?: string;
  children: GedcomNode[];
}

/** A fully parsed GEDCOM document. */
export interface ParsedDocument {
  version: ParseableVersion;
  header: ParsedHeader;
  records: ParsedRecord[];
  /** Top-level `_`-prefixed extension records. */
  extensions: GedcomNode[];
  diagnostics: Diagnostic[];
}

/** Summary counts attached to a {@link ConversionResult}. */
export interface ConversionStats {
  recordsProcessed: number;
  /** Count of `warning`-severity diagnostics. */
  unsupportedStructures: number;
  /** Count of `_`-prefixed extensions preserved in the output. */
  preservedExtensions: number;
}

/** The output of {@link ConvertOptions}-driven conversion. */
export interface ConversionResult {
  version: SupportedVersion;
  output: string;
  diagnostics: Diagnostic[];
  stats: ConversionStats;
}

/** Options for {@link ParsedDocument} parsing. */
export interface ParseOptions {
  /** Force a version instead of auto-detecting. */
  version?: ParseableVersion;
}

/** Line-ending style the serializer emits. GEDCOM permits CR, LF, or CRLF. */
export type GedcomLineEnding = "LF" | "CRLF" | "CR";

/** Options for {@link ParsedDocument} serialization. */
export interface StringifyOptions {
  /** Target version to emit. */
  version: SupportedVersion;
  /** Line ending for the emitted text. Defaults to `"LF"`. */
  lineEnding?: GedcomLineEnding;
}

/** The result of parsing a GEDZIP (`.gdz`) archive. */
export interface ParsedGedzip {
  /** The parsed `gedcom.ged` dataset from the archive. */
  document: ParsedDocument;
  /** Local files bundled in the archive, keyed by their archive path (FilePath payload). */
  files: Map<string, Uint8Array>;
  /** Diagnostics from unzipping and from parsing the dataset. */
  diagnostics: Diagnostic[];
}

/** Options controlling a {@link ConversionResult conversion}. */
export interface ConvertOptions {
  /** Source version (use {@link DetectedVersion} detection if unknown). */
  from: ParseableVersion;
  /** Target version. */
  to: SupportedVersion;
  /** Reject the conversion (throw) if any `warning` diagnostic is emitted. */
  strict?: boolean;
  /** @experimental Reserved for finer control over extension preservation; no effect yet. */
  preserveUnknown?: boolean;
  /** @experimental Reserved for finer control over header metadata preservation; no effect yet. */
  preserveHeaderMeta?: boolean;
}
