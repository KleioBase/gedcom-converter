# `@kleiobase/gedcom-converter`

`@kleiobase/gedcom-converter` is a TypeScript library for reading and converting GEDCOM files.

It is built for applications that need to work with real genealogy data across GEDCOM versions without silently emitting broken output.

## What it does

- detects GEDCOM versions from text or bytes
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
  - `5.5 -> 5.5.1`

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

### `convertGedcom(input, { from, to, strict?, preserveUnknown?, preserveHeaderMeta? })`

Converts a GEDCOM file and returns:

- `output`
- `diagnostics`
- `stats`

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

## Limits

- textual `.ged` files only
- no CLI package yet
- no GEDZIP support
- reverse conversion not implemented yet
- some structures are intentionally preserved as `_TAG` instead of being aggressively rewritten

## References

- [GEDCOM 7.0.18 specification](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html)
- [GEDCOM 5.5.1 specification](https://gedcom.io/specifications/ged551.pdf)
- [GEDCOM migration guide](https://gedcom.io/migrate/)
