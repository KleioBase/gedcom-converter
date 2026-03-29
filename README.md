# `@kleiobase/gedcom-converter`

`@kleiobase/gedcom-converter` is an open-source npm package for converting GEDCOM files between specification versions.

The first supported path is FamilySearch GEDCOM `7.0.18` to GEDCOM `5.5.1`, built primarily for KleioBase's needs but structured for future bidirectional and multi-version support.

## Current scope

- Library-first API
- Textual `.ged` files only
- Version detection, parsing, stringifying, and conversion scaffolding
- Initial version-aware conversion pipeline through a version-neutral IR

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
- Unknown extension tags beginning with `_` are preserved in parsed output and, where possible, during conversion.

## References

- [GEDCOM 7.0.18 specification](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html)
- [GEDCOM 5.5.1 specification](https://gedcom.io/specifications/ged551.pdf)
- [GEDCOM migration guide](https://gedcom.io/migrate/)
