# API stability

This is the reviewed public surface of `@kleiobase/gedcom-converter` and the
stability commitment for each export, ahead of v1.0. Everything importable from
the package root (`@kleiobase/gedcom-converter`) is listed; nothing else is public.

Generated from the TypeScript declaration rollup (`tsc` emit) and reviewed by hand.
Regenerate with `npm run build` and inspect `dist/index.d.ts` + `dist/**/*.d.ts`.

## Stability levels

- **stable**: covered by SemVer. A breaking change bumps MAJOR (see
  [`release-process.md`](./release-process.md)).
- **experimental**: may change in a MINOR release. Marked `@experimental` in TSDoc.
- **internal**: not exported from the package root (parsers, serializers, the ZIP
  codec, the CLI runner). Reachable only through deep import paths and not part of
  the public contract.

## Functions

| Export | Signature | Stability |
| --- | --- | --- |
| `detectGedcomVersion` | `(input: string \| Uint8Array) => DetectedVersion` | stable |
| `parseGedcom` | `(input: string \| Uint8Array, options?: ParseOptions) => ParsedDocument` | stable |
| `streamGedcomRecords` | `(input: string \| Uint8Array, options?: ParseOptions) => GedcomRecordStream` | stable |
| `stringifyGedcom` | `(document: ParsedDocument, options: StringifyOptions) => string` | stable |
| `convertGedcom` | `(input: string \| Uint8Array, options: ConvertOptions) => ConversionResult` | stable |
| `parseGedcomZip` | `(input: Uint8Array) => Promise<ParsedGedzip>` | stable |
| `stringifyGedcomZip` | `(document, files, options) => Promise<Uint8Array>` | stable |
| `looksLikeZip` | `(input: string \| Uint8Array) => boolean` | stable |

## Types

| Type | Stability | Notes |
| --- | --- | --- |
| `SupportedVersion`, `ParseableVersion`, `DetectedVersion` | stable | Version string unions. |
| `DiagnosticSeverity`, `Diagnostic`, `DiagnosticLocation` | stable | `Diagnostic.code` strings are part of the contract; see the [fidelity matrix](./fidelity-matrix.md). |
| `GedcomNode`, `ParsedHeader`, `ParsedRecord`, `ParsedDocument` | stable | The document model. |
| `GedcomRecordStream` | stable | Lazy, single-pass iterable returned by `streamGedcomRecords`. |
| `ConversionResult`, `ConversionStats` | stable | |
| `ParseOptions`, `StringifyOptions`, `GedcomLineEnding` | stable | |
| `ConvertOptions` | stable | The fields `preserveUnknown` and `preserveHeaderMeta` are **experimental** (reserved; no effect yet). |
| `ParsedGedzip`, `StringifyGedcomZipOptions` | stable | |

## Contract notes

- **Diagnostic codes are public.** Adding a code is MINOR; removing or renaming one
  is MAJOR. New conversion coverage may add codes.
- **Conversion output** follows the documented [fidelity matrix](./fidelity-matrix.md).
  A change that moves a tag's outcome (e.g. `clean` → `lossy`) is MAJOR; a fix that
  moves output *toward* the documented behaviour is PATCH.
- **`GedcomNode.lineNumber`** is best-effort metadata and may be absent.
- **`streamGedcomRecords`** is GEDCOM 7 only and single-pass: it yields every
  top-level record between `HEAD` and `TRLR` (extension records included) in
  document order, throws on a non-7 or undetectable version, and may throw
  mid-iteration on a malformed line past the header. `GedcomRecordStream.version`
  is always `"7.0.18"`.
- **Internal modules** (`src/gedcom7`, `src/gedcom551`, `src/mappings`, `src/gedzip/zip*`,
  `src/cli`, `src/utils`) are not exported from the root and carry no stability guarantee.

## Public declaration rollup (reviewed)

```ts
function detectGedcomVersion(input: string | Uint8Array): DetectedVersion;
function parseGedcom(input: string | Uint8Array, options?: ParseOptions): ParsedDocument;
function streamGedcomRecords(input: string | Uint8Array, options?: ParseOptions): GedcomRecordStream;
function stringifyGedcom(document: ParsedDocument, options: StringifyOptions): string;
function convertGedcom(input: string | Uint8Array, options: ConvertOptions): ConversionResult;
function parseGedcomZip(input: Uint8Array): Promise<ParsedGedzip>;
function stringifyGedcomZip(document: ParsedDocument, files: Map<string, Uint8Array>, options: StringifyGedcomZipOptions): Promise<Uint8Array>;
function looksLikeZip(input: string | Uint8Array): boolean;

type SupportedVersion = "5.5.1" | "7.0.18";
type ParseableVersion = "5.5" | SupportedVersion;
type DetectedVersion = ParseableVersion | "unknown";
type DiagnosticSeverity = "info" | "warning" | "error";
type GedcomLineEnding = "LF" | "CRLF" | "CR";

interface DiagnosticLocation { line?: number; recordId?: string; tag?: string; }
interface Diagnostic { severity: DiagnosticSeverity; code: string; message: string; location?: DiagnosticLocation; }
interface GedcomNode { level: number; tag: string; value?: string; xref?: string; children: GedcomNode[]; lineNumber?: number; }
interface ParsedHeader { sourceSystem?: string; gedcomVersion?: string; characterSet?: string; raw: GedcomNode; }
interface ParsedRecord { tag: string; xref?: string; value?: string; children: GedcomNode[]; }
interface ParsedDocument { version: ParseableVersion; header: ParsedHeader; records: ParsedRecord[]; extensions: GedcomNode[]; diagnostics: Diagnostic[]; }
interface GedcomRecordStream extends Iterable<ParsedRecord> { readonly header: ParsedHeader; readonly version: ParseableVersion; readonly diagnostics: Diagnostic[]; }
interface ConversionStats { recordsProcessed: number; unsupportedStructures: number; preservedExtensions: number; }
interface ConversionResult { version: SupportedVersion; output: string; diagnostics: Diagnostic[]; stats: ConversionStats; }
interface ParseOptions { version?: ParseableVersion; strict?: boolean; }
interface StringifyOptions { version: SupportedVersion; lineEnding?: GedcomLineEnding; }
interface ConvertOptions { from: ParseableVersion; to: SupportedVersion; strict?: boolean; preserveUnknown?: boolean; preserveHeaderMeta?: boolean; }
interface ParsedGedzip { document: ParsedDocument; files: Map<string, Uint8Array>; diagnostics: Diagnostic[]; }
interface StringifyGedcomZipOptions extends StringifyOptions { diagnostics?: Diagnostic[]; }
```
