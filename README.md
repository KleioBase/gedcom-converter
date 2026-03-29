# `@kleiobase/gedcom-converter`

`@kleiobase/gedcom-converter` is a TypeScript-first library for reading, inspecting, normalizing, and converting GEDCOM files between versions.

It is designed for projects that need to work with real genealogical data while staying practical about version differences, partial compatibility, and messy files from the wild.

## What it is for

Use this package when you need to:

- detect which GEDCOM version a file uses
- parse GEDCOM text into a structured document
- convert supported GEDCOM versions into a different target version
- serialize parsed documents back into GEDCOM text
- preserve data safely when a feature has no clean equivalent in the target version

This makes it useful for:

- genealogy apps and databases
- migration utilities
- import pipelines
- archival or interoperability tooling
- test harnesses for GEDCOM processing

## Why use it

- Library-first API: built to be embedded in your own app or scripts
- TypeScript-friendly: strong exported types for documents, diagnostics, and conversion results
- Version-aware: keeps parsing, mapping, and serialization separated by GEDCOM version
- Safety-oriented: prefers valid output plus diagnostics over silently emitting invalid GEDCOM
- Extension-preserving: unsupported or version-specific structures can be retained as `_TAG` data instead of being dropped

## Current support

Supported today:

- parse: `7.0.18`, `5.5.1`, and legacy `5.5`
- stringify: `7.0.18` and `5.5.1`
- convert:
  - `7.0.18 -> 5.5.1`
  - `5.5 -> 5.5.1`

Planned direction:

- broader 7.x mapping coverage
- reverse conversion paths
- additional GEDCOM versions

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

const detected = detectGedcomVersion(input);

const result = convertGedcom(input, {
  from: detected === "unknown" ? "7.0.18" : detected,
  to: "5.5.1"
});

console.log(result.output);
console.log(result.diagnostics);
```

## API

### `detectGedcomVersion(input)`

Detects the source GEDCOM version from text or bytes.

Returns:

- `"7.0.18"`
- `"5.5.1"`
- `"5.5"`
- `"unknown"`

### `parseGedcom(input, { version? })`

Parses GEDCOM text into a structured `ParsedDocument`.

Use this when you want to inspect or transform a GEDCOM file without immediately converting it.

### `stringifyGedcom(document, { version })`

Serializes a parsed document back into GEDCOM text for the requested target version.

### `convertGedcom(input, { from, to, strict?, preserveUnknown?, preserveHeaderMeta? })`

Converts a GEDCOM file from one supported version to another and returns:

- `output`: the converted GEDCOM text
- `diagnostics`: warnings or errors about degraded or unsupported structures
- `stats`: summary counts such as processed records and preserved extensions

## How conversion behaves

The converter is intentionally conservative.

When a GEDCOM 7 structure maps cleanly into GEDCOM 5.5.1, it is converted into standard 5.5.1 tags.

When it does not map cleanly, the converter prefers one of these outcomes:

- preserve the original information as a user-defined `_TAG`
- normalize the value into the closest valid 5.5.1 form
- emit a diagnostic so your application can surface or review the loss

This means the package optimizes first for:

1. valid output
2. data preservation
3. diagnostics
4. perfect semantic equivalence

## Current conversion characteristics

The current `7.0.18 -> 5.5.1` path includes:

- GEDCOM version detection and parsing
- continuation-line handling for GEDCOM 7 `CONT` and GEDCOM 5.x `CONT` / `CONC`
- shared note conversion
- partial date conversion
- partial identifier conversion
- partial multimedia conversion
- compatibility cleanup for structures that GEDCOM 5.5.1 does not accept directly

This does not mean every GEDCOM 7 construct has a lossless 5.5.1 equivalent yet.

## Diagnostics

Diagnostics are part of the normal conversion result and are important to consume.

Common examples include:

- unsupported identifiers
- degraded date phrases
- preserved extension data
- dropped broken pointer references
- structures demoted to `_TAG` for 5.5.1 compatibility

If you need conversion to fail whenever warnings appear, use `strict: true`.

## Example output workflow

A common pattern is:

1. detect the input version
2. convert to the target version
3. save the result
4. inspect diagnostics

```ts
import { convertGedcom, detectGedcomVersion } from "@kleiobase/gedcom-converter";
import { readFileSync, writeFileSync } from "node:fs";

const input = readFileSync("input.ged", "utf8");
const from = detectGedcomVersion(input);

if (from === "unknown") {
  throw new Error("Could not detect GEDCOM version");
}

const result = convertGedcom(input, {
  from,
  to: "5.5.1"
});

writeFileSync("output.ged", result.output, "utf8");

for (const diagnostic of result.diagnostics) {
  console.log(`${diagnostic.severity}: ${diagnostic.code} - ${diagnostic.message}`);
}
```

## Validation

The project uses automated tests, focused fixtures, official GEDCOM sample files, and external validation tools as part of development.

The current 5.5.1 output has been validated against official sample data such as `maximal70.ged`, and generated output is checked for valid GEDCOM 5.5.1 structure rather than only internal test success.

That said, GEDCOM conversion is not universally lossless. If a structure cannot be represented cleanly in the target version, this package will usually preserve it as `_TAG` data and surface diagnostics rather than silently discarding it.

## Repository helper

This repository also includes a local helper command for manually converting a file into a gitignored temp folder:

```bash
npm run convert:file -- fixtures/official/gedcom70/maximal70.ged
```

That writes the converted file to:

```text
.tmp/generated/<input-name>.5.5.1.ged
```

This helper is mainly for local validation and development of the package itself.

## Limits

- textual `.ged` files only
- no CLI package yet
- no GEDZIP support
- reverse conversion is not implemented yet
- some structures are intentionally preserved as `_TAG` instead of being aggressively rewritten

## References

- [GEDCOM 7.0.18 specification](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html)
- [GEDCOM 5.5.1 specification](https://gedcom.io/specifications/ged551.pdf)
- [GEDCOM migration guide](https://gedcom.io/migrate/)
