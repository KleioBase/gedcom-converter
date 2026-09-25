# Changelog

All notable changes to `@kleiobase/gedcom-converter` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [`docs/release-process.md`](./docs/release-process.md) for the release policy.

## [0.5.1] - 2026-09-25

### Fixed

- 5.5.1 → 7.0 conversion now also fixes `BET … AND …` date ranges that carry a
  qualifier on either end (`BET ABT 1936 AND 1939`, `BET AFT APR 1904 AND BEF
  1907`). They passed through unchanged, producing invalid 7.0 output with no
  diagnostic. They now get the same treatment as qualified `FROM`/`TO` periods:
  the qualifiers are removed from the 7.0 payload, the source wording is kept as
  a `PHRASE`, `QUALIFIED_DATE_PERIOD_NORMALIZED` is raised, and converting back
  to 5.5.1 restores the original wording.

## [0.5.0] - 2026-09-25

### Fixed

- 5.5.1 output keeps the multimedia `FILE` reference for `image/png` and
  `image/webp`, emitted as `2 FORM png` and `2 FORM webp`. Both MIME types were
  missing from the down-converter's table, so the whole `FILE` was replaced by a
  `File reference:` note and the link was lost. Like `pdf`, `mp3`, `mp4` and
  `txt`, neither token is in the 5.5.1 `MULTIMEDIA_FORMAT` enumeration, but both
  are understood in practice, and a 5.5.1 file holding them now round-trips
  through 7.0 unchanged. A media type that still cannot be mapped now keeps its
  format in a `File format:` note next to the `File reference:` note, so the
  reference can be rebuilt.
- 5.5.1 → 7.0 conversion now fixes date periods that carry a qualifier inside
  `FROM`/`TO`, as MyHeritage writes them (`FROM ABT 1920 TO BEF 1930`). Neither
  date grammar allows this, and the period was previously passed through as
  invalid 7.0 output with no diagnostic. The qualifier is now removed from the
  payload (`2 DATE FROM 1920 TO 1930`), the source wording is kept as
  `3 PHRASE FROM ABT 1920 TO BEF 1930`, and the new
  `QUALIFIED_DATE_PERIOD_NORMALIZED` diagnostic is raised. Converting back to
  5.5.1 restores the source wording, so the round-trip is unchanged.
- 5.5.1 → 7.0 conversion now rewrites the XML that MyHeritage writes into the
  free-text `DSCR` payload (`<DSCR><HAIR>Brown</HAIR><HEIGHT>146</HEIGHT></DSCR>`)
  as readable text (`Hair: Brown, Height: 146`), raising the new
  `DSCR_XML_PAYLOAD_NORMALIZED` diagnostic. Unknown elements keep a generic
  label, and malformed or truncated XML is left exactly as it was.

## [0.4.0] - 2026-08-13

The fixes below change the bytes this library emits for 5.5.1 output. All move
output toward the specification, and none require a code change to adopt, but a
consumer that byte-compares output will see differences in `RESN`, `NAME.TYPE`,
`FAMC.STAT`, LDS ordinance `STAT`, and source media types.

### Fixed

- 5.5.1 output no longer carries GEDCOM 7 enumeration spellings for `RESN` and
  `NAME.TYPE`. `RESTRICTION_NOTICE` (5.5.1 p.60) is a closed lowercase set with
  no `<user defined>` escape, so `1 RESN CONFIDENTIAL` — which a 5.5.1 consumer
  validating the enumeration rejects, dropping the restriction marker — is now
  emitted as `1 RESN confidential`. The enum is matched case-insensitively, so a
  document that already holds the spec-correct 5.5.1 value is left alone; it was
  previously rewritten *into* the 7.0 spelling and told it had been "reduced for
  GEDCOM 5.5.1 compatibility". `RESN_REDUCED` is now raised only for the genuine
  comma-list-to-single-value reduction, not for a casing rewrite. `NAME.TYPE
  PROFESSIONAL` (legal 5.5.1 `<user defined>` text, but the one 7.0-cased value
  among its lowercase siblings) is now emitted as `professional`. An OBJE-level
  `RESN`, which 5.5.1 cannot express and which is hoisted to a note, keeps the
  7.0 value verbatim in that prose — it is no longer truncated to one token.
- `FAMC.STAT` is no longer routed through the LDS ordinance status mapper. 5.5.1
  `CHILD_LINKAGE_STATUS` (p.44) and the LDS ordinance status share the `STAT`
  tag but are different enumerations, and treating the former as the latter
  broke it in both directions: `2 STAT proven` up-converted to a valueless
  `2 STAT` with the payload stranded in a `PHRASE` (invalid GEDCOM 7, and
  reported under the misleading `LDS_STAT_UNMAPPED`), and `2 STAT PROVEN`
  down-converted unchanged instead of to 5.5.1's lowercase `proven`. A 5.5.1
  child-linkage status now survives a round-trip intact. A value outside the
  enumeration is preserved as `_STAT` with the new `FAMC_STAT_UNMAPPED`. Both
  `STAT` mappers now dispatch on the parent tag, so a `STAT` in a position 5.5.1
  does not define (neither an LDS ordinance nor `FAMC`) keeps its value on the
  line instead of having it moved into a `PHRASE`.
- LDS ordinance `STAT` values that 5.5.1 spells with different punctuation are
  re-spelled instead of being flattened into note prose. 5.5.1 uses `PRE-1970`
  and `DNS/CAN` where GEDCOM 7 uses `PRE_1970` and `DNS_CAN`; the up-converter
  already normalised these, so a valid 5.5.1 file lost its structured ordinance
  status on a plain round-trip. Because 5.5.1 scopes its status enumerations per
  ordinance where 7.0 has one flat set, the mapping is now per-ordinance: a
  value that ordinance's 5.5.1 enumeration genuinely lacks (7.0's `INFANT`, or
  `DNS/CAN` outside `SLGS`) still becomes a note. A `STAT` value that is not a
  GEDCOM 7 enum member at all reached 5.5.1 from a 5.5.1 source as free text and
  is passed through untouched rather than rewritten.
- Source media types are emitted in the 5.5.1 spelling. `SOURCE_MEDIA_TYPE`
  (p.62) is lowercase and, like `RESN`, closed — it has no `<user defined>`
  escape — so `3 TYPE PHOTO` had no legal reading. Both locations are covered:
  `OBJE.FILE.FORM.TYPE`, and `SOUR.REPO.CALN.MEDI`, which previously had no
  media-type handling at all. As with `RESN`, an already-correct 5.5.1 value was
  being actively rewritten *into* the 7.0 spelling; it is now left alone.

## [0.3.0] - 2026-08-13

Three of the fixes below change the bytes this library emits. All move output
toward the specification, and none require a code change to adopt, but a consumer
that byte-compares output or pins on the old behaviour will see a difference:

- every GEDCOM 7 stream now starts with a U+FEFF byte-order mark;
- `stringifyGedcom` targeting a version other than the document's own now maps
  the document instead of passing record bodies through unchanged;
- `detectGedcomVersion` can now return a different version for files whose
  `HEAD.SOUR.VERS` previously masked `HEAD.GEDC.VERS`.

### Fixed

- `stringifyGedcom(document, { version })` now maps the document to the target
  version when `version` differs from `document.version`, instead of serializing
  the source version's record bodies under the target version's header. A GEDCOM
  7 document serialized as 5.5.1 previously kept 7.0 enumeration casing
  (`2 TYPE MAIDEN`, `2 PEDI BIRTH`) and 7-only tags such as `NO`, which 5.5.1
  consumers reject. `stringifyGedcom` and `convertGedcom` now share one mapping
  path and produce identical output for identical input, in both the
  7.0.18 → 5.5.1 and 5.5.1 → 7.0.18 directions. `stringifyGedcomZip` inherits the
  fix for its `gedcom.ged` entry, which callers could not correct themselves.
  Serializing to the document's own version is unchanged.
- GEDCOM 7 output now begins with a U+FEFF byte-order mark, as §1.1 requires
  ("the first character in each data stream should be U+FEFF"). This covers the
  `gedcom.ged` entry written inside a `.gdz` archive, which callers could not
  prepend one to themselves. 5.5.1 output is unchanged and still has no BOM.
  A leading BOM was already stripped on input, so round-tripping is unaffected.
- `detectGedcomVersion` now reads `HEAD.GEDC.VERS` specifically, instead of the
  first `2 VERS` line anywhere in the file. Exporters record their own product
  version in `HEAD.SOUR.VERS`, which precedes `GEDC`: MyHeritage stamps a literal
  `2 VERS 5.5.1` there, so its GEDCOM 7 files — including ones this library
  produced — were detected as 5.5.1, parsed by the 5.5.1 parser, and rejected by
  `streamGedcomRecords`. Both parsers already scoped the lookup to `HEAD.GEDC`;
  detection now agrees with them. A header with no `GEDC.VERS` at all still falls
  back to the previous loose scan.

### Added

- `StringifyOptions.diagnostics`: an optional sink collecting the warnings raised
  by the cross-version mapping described above. Serialization still never throws
  on a warning; use `convertGedcom(..., { strict: true })` for that.
- `StringifyOptions.bom`: overrides the per-version byte-order mark default —
  `false` suppresses it on GEDCOM 7 output, `true` adds one to 5.5.1 output.

## [0.2.2] - 2026-06-08

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

[0.5.1]: https://github.com/KleioBase/gedcom-converter/releases/tag/v0.5.1
[0.5.0]: https://github.com/KleioBase/gedcom-converter/releases/tag/v0.5.0
[0.4.0]: https://github.com/KleioBase/gedcom-converter/releases/tag/v0.4.0
[0.3.0]: https://github.com/KleioBase/gedcom-converter/releases/tag/v0.3.0
[0.2.2]: https://github.com/KleioBase/gedcom-converter/releases/tag/v0.2.2
[0.2.1]: https://github.com/KleioBase/gedcom-converter/releases/tag/v0.2.1
[0.2.0]: https://github.com/KleioBase/gedcom-converter/releases/tag/v0.2.0

