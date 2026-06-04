# `@kleiobase/gedcom-converter`

[![CI](https://github.com/KleioBase/gedcom-converter/actions/workflows/ci.yml/badge.svg)](https://github.com/KleioBase/gedcom-converter/actions/workflows/ci.yml)

`@kleiobase/gedcom-converter` is a TypeScript library for reading and converting GEDCOM files.

It is built for applications that need to work with real genealogy data across GEDCOM versions without silently emitting broken output.

## What it does

- detects GEDCOM versions from text or bytes
- decodes input byte streams from ANSEL (the pre-7.0 default), UTF-16, or UTF-8 based on the BOM and `1 CHAR`
- parses GEDCOM into a structured document model
- stringifies parsed documents back into GEDCOM text
- converts supported versions into other supported versions
- preserves unsupported data as diagnostics or `_TAG` fallbacks when needed

Typical use cases:

- genealogy apps
- import and migration pipelines
- archival tooling
- interoperability utilities
- automated GEDCOM validation workflows

## Current support

- parse: `7.0.18`, `5.5.1`, legacy `5.5`
- stringify: `7.0.18`, `5.5.1`
- convert:
  - `7.0.18 -> 5.5.1`
  - `5.5.1 -> 7.0.18`
  - `5.5 -> 5.5.1`
  - `5.5 -> 7.0.18`

## Why use it

- TypeScript-first API with exported document and diagnostic types
- version-aware parsing, mapping, and serialization
- compatibility-focused conversion that favors valid GEDCOM over unsafe guesses
- preservation of unsupported structures instead of silent data loss

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

Runnable recipes live in [`examples/`](./examples/README.md) — parsing, building a
document, converting with diagnostics, severity reports, and GEDZIP bundling. Run
any with `npx tsx examples/<name>.ts`.

## API

### `detectGedcomVersion(input)`

Returns one of:

- `"7.0.18"`
- `"5.5.1"`
- `"5.5"`
- `"unknown"`

### `parseGedcom(input, { version? })`

Parses GEDCOM text into a `ParsedDocument`.

### `stringifyGedcom(document, { version })`

Serializes a parsed document into GEDCOM text for the requested version.

### `parseGedcomZip(input)`

Parses a FamilySearch GEDZIP (`.gdz`) archive. Returns a `Promise<ParsedGedzip>`
with the parsed `document`, a `files` map of bundled media (keyed by archive path),
and `diagnostics`. Encrypted archives reject with a clear error; `META-INF` entries
are ignored with a diagnostic. Use `looksLikeZip(input)` to detect GEDZIP bytes.

### `stringifyGedcomZip(document, files, { version, lineEnding?, diagnostics? })`

Serializes a document and its bundled media into a GEDZIP (`.gdz`) archive
(`Promise<Uint8Array>`). The dataset is written as `gedcom.ged` (deflated);
already-compressed media is stored. Pass a `diagnostics` array to collect a
`GEDZIP_FILE_MISSING` warning for any referenced local file you didn't provide.

### `convertGedcom(input, { from, to, strict?, preserveUnknown?, preserveHeaderMeta? })`

Converts a GEDCOM file and returns:

- `output`
- `diagnostics`
- `stats`

## CLI

The package ships a `gedcom-convert` binary:

```bash
gedcom-convert detect <file>
gedcom-convert parse <file> [--version <v>]
gedcom-convert stringify <input.json> --version <v> [-o <out>]
gedcom-convert convert <input> --to <v> [--from <v>] [-o <out>] [--strict] [--preserve-unknown]
gedcom-convert validate <file> [--against <v>]
gedcom-convert roundtrip <file> [--version <v>]
```

A `<file>` of `-` reads from standard input; without `-o`, output goes to standard
output, so commands pipe cleanly. Exit codes: `0` success, `1` error, `2`
strict-mode warning, `64` usage error. Diagnostics print to stderr (coloured on a
TTY; honours `NO_COLOR`). Run with `--help` for usage.

```bash
npx @kleiobase/gedcom-converter convert input.ged --to 5.5.1 -o output.ged
```

## Conversion model

The converter is intentionally conservative.

When a structure maps cleanly into the target version, it is converted to a standard tag.

When it does not, the converter prefers to:

- preserve the information as `_TAG` data
- normalize it into the closest valid target form
- emit diagnostics so the caller can review what changed

That means the package prioritizes:

1. valid output
2. data preservation
3. explicit diagnostics

over aggressive or lossy rewriting.

## Diagnostics

Diagnostics are part of normal conversion output. They are useful for:

- unsupported identifiers
- degraded date phrases
- dropped broken pointer references
- preserved extension data
- compatibility-driven demotions to `_TAG`

If you want warnings to fail conversion, use `strict: true`.

For a per-tag breakdown of what every conversion direction does — `clean`, `lossy: …`, `_TAG`, `dropped`, or `N/A` — and the diagnostic code each lossy path emits, see [`docs/fidelity-matrix.md`](./docs/fidelity-matrix.md).

## Local repository helper

This repository includes a helper script for converting a real file into a gitignored temp folder:

```bash
npm run convert:file -- fixtures/official/gedcom70/maximal70.ged
```

That writes to:

```text
.tmp/generated/<input-name>.5.5.1.ged
```

This helper is for repository development and manual validation.

## Validation status

The current `7.0.18 -> 5.5.1` path is validated with automated tests, focused fixtures, official GEDCOM sample files, and external validation tools.

Generated 5.5.1 output from the official `maximal70.ged` sample has been validated successfully in GED-inline.

Validation does not mean all conversions are lossless. Some GEDCOM 7 constructs still need to be preserved as `_TAG` data when GEDCOM 5.5.1 has no clean equivalent.

## Character encodings and line endings

Input byte streams (`Uint8Array`) are decoded automatically based on the byte-order
mark and the `1 CHAR` declaration:

| Declared / detected | Decoded as |
| --- | --- |
| UTF-8 BOM, or `1 CHAR UTF-8` / `ASCII` | UTF-8 (ASCII is a subset) |
| UTF-16 BOM (`FF FE` / `FE FF`), or `1 CHAR UNICODE` | UTF-16 LE / BE |
| `1 CHAR ANSEL` (the pre-7.0 default) | ANSEL, including combining diacritics (reordered + NFC-composed) |

GEDCOM 7 output is always UTF-8 (spec mandate); 5.5.1 output is UTF-8 with a
`1 CHAR UTF-8` header. Passing a `string` skips decoding (only the BOM is stripped).

CR, LF, and CRLF line endings are all parsed, and the parser produces identical
records regardless of the input style. The serializer emits LF by default; pass
`lineEnding` to choose:

```ts
stringifyGedcom(document, { version: "7.0.18", lineEnding: "CRLF" });
```

## Limits

- textual `.ged` files only
- GEDZIP `.gdz` reading and writing are supported (`parseGedcomZip` / `stringifyGedcomZip`)
- no full semantic GEDCOM schema validator yet
- some structures are intentionally preserved as `_TAG` instead of being aggressively rewritten

## Releases

- Version history: [`CHANGELOG.md`](./CHANGELOG.md)
- Public API surface and stability: [`docs/api-stability.md`](./docs/api-stability.md)
- Versioning and publishing policy: [`docs/release-process.md`](./docs/release-process.md)

## References

- [GEDCOM 7.0.18 specification](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html)
- [GEDCOM 5.5.1 specification](https://gedcom.io/specifications/ged551.pdf)
- [GEDCOM migration guide](https://gedcom.io/migrate/)
