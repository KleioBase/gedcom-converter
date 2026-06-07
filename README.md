# `@kleiobase/gedcom-converter`

[![CI](https://github.com/KleioBase/gedcom-converter/actions/workflows/ci.yml/badge.svg)](https://github.com/KleioBase/gedcom-converter/actions/workflows/ci.yml)

A TypeScript library for reading, writing, and converting GEDCOM files. It
supports GEDCOM 7.0.18, 5.5.1, and legacy 5.5, and converts between them.

Conversion favours valid output. When a structure has no equivalent in the
target version, the converter preserves it as extension data or records a
diagnostic rather than discarding it without notice.

## Features

- **Version detection** from text or bytes (`detectGedcomVersion`).
- **Byte-stream decoding** for ANSEL (the pre-7.0 default), UTF-16 LE/BE, ASCII,
  and UTF-8, selected from the byte-order mark and the `1 CHAR` declaration.
- **Parsing** into a structured document model (`parseGedcom`), lenient by
  default with recoverable issues reported as diagnostics, or `strict` to throw.
- **Streaming** a document's top-level records one at a time
  (`streamGedcomRecords`) so large files never materialise the whole node tree.
- **Serialization** back to GEDCOM text (`stringifyGedcom`), with a selectable
  line ending.
- **Conversion** between supported versions (`convertGedcom`), favouring valid
  output, then data preservation, then an explicit diagnostic.
- **GEDZIP** (`.gdz`) reading and writing (`parseGedcomZip`,
  `stringifyGedcomZip`, `looksLikeZip`).
- **Rich conversion coverage**: personal names, individual/family events and
  attributes, LDS ordinances, sources/citations/repositories, associations,
  notes and shared notes, multimedia (with `FORM` → MIME mapping), and a
  centralised enumeration layer with bidirectional `OTHER` + `PHRASE`
  round-tripping.
- **Date handling**: phrases, ranges, periods, partial and dual dates, the
  Gregorian, Julian, Hebrew, and French Republican calendars, and legacy epoch
  markers.
- **Preservation** of unsupported structures as diagnostics or `_TAG`
  extensions, so conversion never silently discards data.
- **CLI** (`gedcom-convert`) covering detect, parse, stringify, convert,
  validate, and round-trip.

## Supported versions

- Parse: `7.0.18`, `5.5.1`, `5.5`.
- Serialize: `7.0.18`, `5.5.1`.
- Convert: `7.0.18 -> 5.5.1`, `5.5.1 -> 7.0.18`, `5.5 -> 5.5.1`, `5.5 -> 7.0.18`.

## Install

```bash
npm install @kleiobase/gedcom-converter
```

## Quick start

```ts
import { convertGedcom, detectGedcomVersion } from "@kleiobase/gedcom-converter";

const input = `0 HEAD
1 SOUR Demo App
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 NAME Ada /Lovelace/
1 BIRT
2 DATE 10 DEC 1815
1 SNOTE @N1@
0 @N1@ SNOTE Shared note
0 TRLR`;

const from = detectGedcomVersion(input);

if (from === "unknown") {
  throw new Error("Could not detect GEDCOM version");
}

const result = convertGedcom(input, {
  from,
  to: "5.5.1"
});

console.log(result.output);
console.log(result.diagnostics);
```

## Examples

The [`examples/`](https://github.com/KleioBase/gedcom-converter/tree/main/examples)
directory contains runnable recipes: parsing, streaming records, building a
document, converting with diagnostics, reporting by severity, and bundling
GEDZIP archives. Clone the repository and run a recipe with
`npx tsx examples/<name>.ts`.

## API

Everything importable from the package root is the public surface; deep imports
are internal and unsupported. The full reviewed list, with per-export stability
levels and the TypeScript declaration rollup, is in
[`docs/api-stability.md`](./docs/api-stability.md).

### Document model

Parsing produces a `ParsedDocument`:

```ts
interface ParsedDocument {
  version: ParseableVersion;          // "5.5" | "5.5.1" | "7.0.18"
  header: ParsedHeader;               // convenience fields + raw HEAD node
  records: ParsedRecord[];            // top-level records, excluding extensions
  extensions: GedcomNode[];           // top-level "_"-prefixed records
  diagnostics: Diagnostic[];          // parse observations
}
```

A `ParsedRecord` is a top-level record (`INDI`, `FAM`, `SOUR`, …) with a `tag`,
optional `xref` and `value`, and a tree of `children` (`GedcomNode`s).
`CONT`/`CONC` continuations are folded into the parent's `value`, so a multi-line
note is one `value` containing `\n`. Every `Diagnostic` carries a stable,
machine-readable `code` (part of the public contract; see the
[fidelity matrix](./docs/fidelity-matrix.md)), a `severity`
(`"info" | "warning" | "error"`), a `message`, and a best-effort `location`.

### `detectGedcomVersion(input)`

Returns `"7.0.18"`, `"5.5.1"`, `"5.5"`, or `"unknown"`. Accepts a string or
`Uint8Array` (decoded by BOM + `1 CHAR`).

### `parseGedcom(input, { version?, strict? })`

Parses GEDCOM text or bytes into a `ParsedDocument`. The version is detected
automatically unless `version` is supplied. Parsing is lenient: a malformed line,
such as a value with an unescaped embedded newline, is recovered and reported as a
`warning` diagnostic rather than throwing. Pass `strict: true` to throw on the
first `warning`/`error` diagnostic instead. Throws if the version cannot be
detected and none is supplied.

### `streamGedcomRecords(input, { version?, strict? })`

Lazily streams a **GEDCOM 7** document's top-level records without holding the
whole node tree in memory, returning a `GedcomRecordStream`. `HEAD` is parsed
eagerly and exposed as `stream.header`; `TRLR` is consumed and never yielded.
Each record subtree is built on demand — exactly one per iterator step — and
becomes garbage-collectable as soon as the consumer advances, so peak heap is
roughly the input plus a single record's subtree rather than the entire tree.
This is the tool to reach for when ingesting large files (for example, inserting
each record into a database).

```ts
interface GedcomRecordStream extends Iterable<ParsedRecord> {
  readonly header: ParsedHeader;       // available before iteration
  readonly version: ParseableVersion;  // always "7.0.18"
  readonly diagnostics: Diagnostic[];  // populated as records are produced
}
```

```ts
import { streamGedcomRecords } from "@kleiobase/gedcom-converter";

const stream = streamGedcomRecords(gedcom7Text);
console.log(`Source: ${stream.header.sourceSystem}`);

for (const record of stream) {
  await insert(record);              // record is GC-eligible after this step
}

console.log(`${stream.diagnostics.length} diagnostic(s)`); // fully populated now
```

The stream is **synchronous, lazy, and single-pass**. Every top-level record
between `HEAD` and `TRLR` is yielded, *including* `_`-prefixed extension records
(which `parseGedcom` instead segregates into `document.extensions`). The input
must be GEDCOM 7: detect the version first and, for 5.5/5.5.1 sources, convert to
7 with `convertGedcom(..., { to: "7.0.18" })` and stream the converted string.
Because parsing is lazy, a malformed line or shape violation (missing/duplicate
`HEAD` or `TRLR`) past the header throws mid-iteration rather than up front.
Throws immediately if the version cannot be detected and none is supplied, or if
the input is GEDCOM 5.5/5.5.1.

### `stringifyGedcom(document, { version })`

Serializes a `ParsedDocument` to GEDCOM text for the requested version.

### `parseGedcomZip(input)`

Parses a FamilySearch GEDZIP (`.gdz`) archive and returns a
`Promise<ParsedGedzip>` with the parsed `document`, a `files` map of bundled
media keyed by archive path, and `diagnostics`. Encrypted archives reject with an
error. `META-INF` entries are ignored and recorded as a diagnostic. Use
`looksLikeZip(input)` to test whether a buffer is GEDZIP.

### `stringifyGedcomZip(document, files, { version, lineEnding?, diagnostics? })`

Serializes a document and its bundled media to a GEDZIP (`.gdz`) archive and
returns a `Promise<Uint8Array>`. The dataset is written as `gedcom.ged`
(deflated); already-compressed media is stored without further compression.
Supply a `diagnostics` array to collect a `GEDZIP_FILE_MISSING` warning for any
referenced local file that is absent from `files`.

### `convertGedcom(input, { from, to, strict?, preserveUnknown?, preserveHeaderMeta? })`

Converts a GEDCOM file from `from` to `to` and returns a `ConversionResult` with
the serialized `output` string, the `diagnostics` recorded along the way, and
`stats` (`recordsProcessed`, `unsupportedStructures`, `preservedExtensions`).
Pass `strict: true` to throw on any `warning` diagnostic. `preserveUnknown` and
`preserveHeaderMeta` are reserved (`@experimental`, no effect yet). Supported
directions are `7.0.18 → 5.5.1`, `5.5.1 → 7.0.18`, `5.5 → 5.5.1`, and
`5.5 → 7.0.18`.

## CLI

The package installs a `gedcom-convert` binary:

```bash
gedcom-convert detect <file>
gedcom-convert parse <file> [--version <v>]
gedcom-convert stringify <input.json> --version <v> [-o <out>]
gedcom-convert convert <input> --to <v> [--from <v>] [-o <out>] [--strict] [--preserve-unknown]
gedcom-convert validate <file> [--against <v>]
gedcom-convert roundtrip <file> [--version <v>]
```

A `<file>` of `-` reads from standard input. Without `-o`, output is written to
standard output, so commands can be piped. Exit codes are `0` for success, `1`
for an error, `2` for a strict-mode warning, and `64` for a usage error.
Diagnostics are written to standard error, coloured on a TTY and suppressed when
`NO_COLOR` is set. Run any command with `--help` for usage.

```bash
npx @kleiobase/gedcom-converter convert input.ged --to 5.5.1 -o output.ged
```

## Conversion model

When a structure maps cleanly onto the target version, it is written as a
standard tag. When it does not, the converter takes one of three actions:

- preserves the data as a `_TAG` extension,
- normalizes it to the closest valid form in the target version, or
- emits a diagnostic that records the change.

The order of preference is valid output first, then preservation of data, then
an explicit diagnostic. The converter does not rewrite data in ways that produce
invalid output or discard information without a diagnostic.

## Diagnostics

Conversion returns a list of diagnostics alongside the output. They report:

- unsupported identifiers,
- degraded date phrases,
- dropped broken pointer references,
- preserved extension data,
- demotions to `_TAG` required for compatibility.

Set `strict: true` to treat warnings as failures.

For the outcome of every tag in every direction (`clean`, `lossy: …`, `_TAG`,
`dropped`, or `N/A`) and the diagnostic code emitted on each lossy path, see
[`docs/fidelity-matrix.md`](./docs/fidelity-matrix.md).

## Repository helper

The repository includes a script that converts a file into a gitignored
temporary folder:

```bash
npm run convert:file -- fixtures/official/gedcom70/maximal70.ged
```

The output is written to:

```text
.tmp/generated/<input-name>.5.5.1.ged
```

The script is intended for development and manual validation within the
repository.

## Validation

The `7.0.18 -> 5.5.1` path is covered by automated tests, targeted fixtures, the
official GEDCOM sample files, and external validation tools. The 5.5.1 output
generated from the official `maximal70.ged` sample validates in GED-inline.

Validation does not imply lossless conversion. Some GEDCOM 7 structures are
preserved as `_TAG` data because GEDCOM 5.5.1 has no equivalent.

## Character encodings and line endings

Byte-stream input (`Uint8Array`) is decoded from the byte-order mark and the
`1 CHAR` declaration:

| Declared / detected | Decoded as |
| --- | --- |
| UTF-8 BOM, or `1 CHAR UTF-8` / `ASCII` | UTF-8 (ASCII is a subset) |
| UTF-16 BOM (`FF FE` / `FE FF`), or `1 CHAR UNICODE` | UTF-16 LE / BE |
| `1 CHAR ANSEL` (the pre-7.0 default) | ANSEL, including combining diacritics (reordered + NFC-composed) |

GEDCOM 7 output is always UTF-8, as required by the specification. GEDCOM 5.5.1
output is UTF-8 with a `1 CHAR UTF-8` header. String input is not decoded; only
the byte-order mark is stripped.

CR, LF, and CRLF line endings are all accepted, and the parser produces the same
records regardless of input style. The serializer emits LF by default. Set
`lineEnding` to override it:

```ts
stringifyGedcom(document, { version: "7.0.18", lineEnding: "CRLF" });
```

## Limitations

- Textual `.ged` input and output only.
- GEDZIP (`.gdz`) reading and writing through `parseGedcomZip` and
  `stringifyGedcomZip`.
- No full semantic GEDCOM schema validator.
- Some structures are preserved as `_TAG` rather than rewritten.
- `streamGedcomRecords` accepts GEDCOM 7 only; convert 5.5/5.5.1 input to 7
  first. It takes a fully decoded string or byte buffer (not yet a
  `ReadableStream`), so the raw input still resides in memory; the saving is the
  document tree, which is the dominant cost.

## Releases

- Version history: [`CHANGELOG.md`](./CHANGELOG.md).
- Public API surface and stability: [`docs/api-stability.md`](./docs/api-stability.md).
- Versioning and publishing policy: [`docs/release-process.md`](./docs/release-process.md).

## References

- [GEDCOM 7.0.18 specification](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html)
- [GEDCOM 5.5.1 specification](https://gedcom.io/specifications/ged551.pdf)
- [GEDCOM migration guide](https://gedcom.io/migrate/)
