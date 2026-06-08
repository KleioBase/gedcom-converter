# Changelog

All notable changes to `@kleiobase/gedcom-converter` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [`docs/release-process.md`](./docs/release-process.md) for the release policy.

## [Unreleased]

### Fixed

- `stringifyGedcomZip` no longer throws `RangeError: Maximum call stack size
  exceeded` when an archive entry is large (e.g. a multi-MB embedded image). The
  ZIP writer previously spread entry bytes into `Array.prototype.push`, passing
  millions of arguments for a single entry; it now accumulates whole byte chunks
  and concatenates once into a preallocated buffer.

## [0.2.1] - 2026-06-07

### Added

- `streamGedcomRecords(input, options?)`: a lazy, single-pass reader that yields a
  GEDCOM 7 document's top-level records one subtree at a time without
  materialising the whole node tree, keeping peak memory at roughly the input
  plus a single record. `HEAD` is parsed eagerly into `stream.header` and `TRLR`
  is consumed but never yielded; extension records are included in the stream. A
  new `GedcomRecordStream` type and a `stream.ts` example accompany it.

## [0.2.0] - 2026-06-05

First public release on npm. (The 0.1.0-alpha milestone below was an internal
development snapshot and was never published; its entries are retained here as
history.)

### Added

- 5.5.1 → 7.0.18 up-conversion: record walker and personal names,
  events / attributes / LDS ordinances, sources / citations / repositories /
  associations / notes, and multimedia / dates / coordinates.
- 5.5 → 7.0 upgrade path.
- Centralised GEDCOM 7 enumeration sets with bidirectional `OTHER` + `PHRASE`
  round-trip.
- Date coverage: phrases (`INT …`/`(…)`), ranges, periods, partial and dual
  dates, and mixed-calendar ranges; Hebrew ADR/ADS leap-year resolution; French
  Republican month validation; and Julian epoch markers with `ROMAN`/`UNKNOWN`
  legacy-calendar handling.
- Character-encoding support: ANSEL (with combining diacritics), UTF-16 LE/BE,
  ASCII, and UTF-8 input detection, plus a `lineEnding` serializer option.
- SCHMA extension declarations now carry URIs and round-trip via a `_SCHMA` block.
- GEDZIP (`.gdz`) reading (`parseGedcomZip`) and writing (`stringifyGedcomZip`).
- `gedcom-convert` CLI binary.
- Runnable example recipes under `examples/`.
- Round-trip test corpus with diagnostic + structural tolerance and the
  conversion fidelity matrix (`docs/fidelity-matrix.md`).

### Fixed

- Up-conversion emitted invalid GEDCOM 7 for `INT`/parenthesised dates, `FONE`/`ROMN`
  name and place variations, and `AFN` identifiers; these now map to valid v7
  (`PHRASE`, `TRAN`, `EXID`). The `_UID` extension is promoted to the standard v7
  `UID` tag.
- `SCHMA` `TAG` declarations were emitted without a URI (invalid per §1.5.1); they
  now include a documented or synthetic URI.
- The parser no longer aborts on a value containing an unescaped embedded newline
  (a line with no level number, seen in some real-world exports). It recovers by
  folding the line into the preceding value and emits a `MALFORMED_LINE_RECOVERED`
  warning. Pass `strict` to `parseGedcom` or `convertGedcom` to treat it as fatal.
- `UID` now round-trips: a v7 `UID` (and a 5.5.1 `_UID`) is preserved as the `_UID`
  extension on the 5.5.1 side instead of being flattened into note text.
- Multimedia `FILE` references are preserved instead of being demoted to notes. The
  obsolete 30-character length demotion was removed, and 5.5-style `OBJE` (where
  `FORM` is a sibling of `FILE`) is restructured so `FORM` nests under `FILE` and
  maps to a v7 MIME type.

### Changed

- `v7 → 5.5.1` reduces remaining `_TAG` fallbacks where a clean 5.5.1 form exists
  (e.g. `PLAC.MAP`, `PLAC.NOTE`).
- v7 `SCHMA` is now preserved as a `_SCHMA` HEAD block on the 5.5.1 side instead of
  `Schema tag:` prose notes.
- The public API surface is documented and frozen for v1.0 in
  [`docs/api-stability.md`](docs/api-stability.md).

### Migration

No breaking API changes in 0.2.0. Every change is additive (a new export) or a
fix that moves output toward the documented behaviour. Consumers that read the
old `Schema tag:` HEAD note should read the `_SCHMA` block instead. The
`ConvertOptions.preserveUnknown` / `preserveHeaderMeta` fields remain reserved
(`@experimental`, no effect).

## [0.1.0-alpha] - 2026-05 (internal milestone — never published)

### Added

- Core API: `detectGedcomVersion`, `parseGedcom`, `stringifyGedcom`, `convertGedcom`.
- Version-aware parsing for 7.0.18, 5.5.1, and legacy 5.5, including CONT/CONC
  continuation handling.
- `7.0.18 → 5.5.1` down-conversion with a compatibility-sanitisation layer that
  favours valid output, data preservation, and explicit diagnostics.
- GEDCOM 7 date conversion layer; legacy 5.5 input normalisation to 5.5.1.
- Official GEDCOM 5.x and 7.0 regression fixtures and tests.
- GitHub Actions CI (typecheck, test, build).

[0.2.1]: https://github.com/KleioBase/gedcom-converter/releases/tag/v0.2.1
[0.2.0]: https://github.com/KleioBase/gedcom-converter/releases/tag/v0.2.0

