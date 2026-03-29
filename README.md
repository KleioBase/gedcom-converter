# `@kleiobase/gedcom-converter`

`@kleiobase/gedcom-converter` is an open-source npm package for converting GEDCOM files between specification versions.

The first supported conversion path is FamilySearch GEDCOM `7.0.18` to GEDCOM `5.5.1`, built primarily for KleioBase's needs but structured for future bidirectional and multi-version support. The parser also accepts legacy GEDCOM `5.5` input so older torture-test and compatibility files can be inspected and normalized.

## Current scope

- Library-first API
- Textual `.ged` files only
- Version detection, parsing, stringifying, and conversion scaffolding
- Initial version-aware conversion pipeline through a version-neutral IR
- Continuation-line handling for GEDCOM 7 `CONT` and GEDCOM 5.5.1 `CONT`/`CONC`
- Initial date, note, identifier, and multimedia mapping for `7.0.18 -> 5.5.1`
- Legacy GEDCOM `5.5` detection and parsing support for official torture-test style fixtures

## Install

```bash
npm install @kleiobase/gedcom-converter
```

## Usage

```ts
import { convertGedcom, detectGedcomVersion } from "@kleiobase/gedcom-converter";

const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 NAME Ada /Lovelace/
1 BIRT
2 DATE BET 1 JAN 1815 AND 31 DEC 1815
3 PHRASE about 1815
0 TRLR`;

const detected = detectGedcomVersion(input);
const result = convertGedcom(input, {
  from: detected === "unknown" ? "7.0.18" : detected,
  to: "5.5.1"
});

console.log(result.output);
```

## API

- `detectGedcomVersion(input)`
- `parseGedcom(input, { version? })`
- `stringifyGedcom(document, { version })`
- `convertGedcom(input, { from, to, strict?, preserveUnknown?, preserveHeaderMeta? })`

## Notes

- GEDCOM 7.0.18 is treated as the stable GEDCOM 7 data shape because GEDCOM 7 patch versions do not change the underlying data model.
- GEDCOM 5.5.1 output currently favors safe interoperability and diagnostic reporting over exhaustive semantic down-conversion.
- The parser recognizes legacy GEDCOM `5.5` input, but cross-version conversion beyond the current `7.0.18 -> 5.5.1` focus is still incremental.
- GEDCOM 7 `PHRASE`-based date nuances are only partially representable in GEDCOM 5.5.1; when they cannot be inlined safely, the converter keeps the date and emits a warning diagnostic.
- Unknown extension tags beginning with `_` are preserved in parsed output and, where possible, during conversion.

## Test Data

- Focused golden fixtures live in `fixtures/` for small, deterministic conversion assertions.
- Official FamilySearch GEDCOM 7 sample files live in `fixtures/official/gedcom70/` and are used as broader regression corpus for parser and converter smoke coverage.
- Official legacy GEDCOM 5.x torture files live in `fixtures/official/gedcom551/` and are used for parser and line-ending compatibility coverage.

## References

- [GEDCOM 7.0.18 specification](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html)
- [GEDCOM 5.5.1 specification](https://gedcom.io/specifications/ged551.pdf)
- [GEDCOM migration guide](https://gedcom.io/migrate/)
