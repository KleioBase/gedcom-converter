# Changelog

All notable changes to `@kleiobase/gedcom-converter` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [`docs/release-process.md`](./docs/release-process.md) for the release policy.

## [0.2.0] - Unreleased

### Added

- 5.5.1 → 7.0.18 up-conversion: record walker and personal names ([GED-4], [GED-5]),
  events / attributes / LDS ordinances ([GED-6]), sources / citations / repositories /
  associations / notes ([GED-7]), and multimedia / dates / coordinates ([GED-8]).
- 5.5 → 7.0 upgrade path ([GED-10]).
- Centralised GEDCOM 7 enumeration sets with bidirectional `OTHER` + `PHRASE`
  round-trip ([GED-15]).
- Comprehensive date coverage — phrases (`INT …`/`(…)`), ranges, periods, partial
  and dual dates, mixed-calendar ranges ([GED-11]); Hebrew ADR/ADS leap-year
  resolution ([GED-12]); French Republican month validation ([GED-13]); Julian
  epoch markers and `ROMAN`/`UNKNOWN` legacy-calendar handling ([GED-14]).
- Character-encoding support: ANSEL (with combining diacritics), UTF-16 LE/BE,
  ASCII, and UTF-8 input detection, plus a `lineEnding` serializer option ([GED-16]).
- SCHMA extension declarations now carry URIs and round-trip via a `_SCHMA` block ([GED-20]).
- GEDZIP (`.gdz`) reading (`parseGedcomZip`) and writing (`stringifyGedcomZip`) ([GED-17], [GED-18]).
- `gedcom-convert` CLI binary ([GED-21]).
- Runnable example recipes under `examples/` ([GED-22]).
- Round-trip test corpus with diagnostic + structural tolerance ([GED-9]) and the
  conversion fidelity matrix (`docs/fidelity-matrix.md`, [GED-3]).

### Fixed

- Up-conversion emitted invalid GEDCOM 7 for `INT`/parenthesised dates, `FONE`/`ROMN`
  name and place variations, and `AFN` identifiers; these now map to valid v7
  (`PHRASE`, `TRAN`, `EXID`). The `_UID` extension is promoted to the standard v7
  `UID` tag.
- `SCHMA` `TAG` declarations were emitted without a URI (invalid per §1.5.1); they
  now include a documented or synthetic URI ([GED-20]).

### Changed

- `v7 → 5.5.1` reduces remaining `_TAG` fallbacks where a clean 5.5.1 form exists
  (e.g. `PLAC.MAP`, `PLAC.NOTE`) ([GED-19]).

## [0.1.0-alpha] - 2026-05

### Added

- Core API: `detectGedcomVersion`, `parseGedcom`, `stringifyGedcom`, `convertGedcom`.
- Version-aware parsing for 7.0.18, 5.5.1, and legacy 5.5, including CONT/CONC
  continuation handling.
- `7.0.18 → 5.5.1` down-conversion with a compatibility-sanitisation layer that
  favours valid output, data preservation, and explicit diagnostics.
- GEDCOM 7 date conversion layer; legacy 5.5 input normalisation to 5.5.1.
- Official GEDCOM 5.x and 7.0 regression fixtures and tests.
- GitHub Actions CI (typecheck, test, build) ([GED-1]).

[0.2.0]: https://github.com/KleioBase/gedcom-converter/compare/v0.1.0-alpha...HEAD
[0.1.0-alpha]: https://github.com/KleioBase/gedcom-converter/releases/tag/v0.1.0-alpha

[GED-1]: https://linear.app/kleiobase/issue/GED-1
[GED-3]: https://linear.app/kleiobase/issue/GED-3
[GED-4]: https://linear.app/kleiobase/issue/GED-4
[GED-5]: https://linear.app/kleiobase/issue/GED-5
[GED-6]: https://linear.app/kleiobase/issue/GED-6
[GED-7]: https://linear.app/kleiobase/issue/GED-7
[GED-8]: https://linear.app/kleiobase/issue/GED-8
[GED-9]: https://linear.app/kleiobase/issue/GED-9
[GED-10]: https://linear.app/kleiobase/issue/GED-10
[GED-11]: https://linear.app/kleiobase/issue/GED-11
[GED-12]: https://linear.app/kleiobase/issue/GED-12
[GED-13]: https://linear.app/kleiobase/issue/GED-13
[GED-14]: https://linear.app/kleiobase/issue/GED-14
[GED-15]: https://linear.app/kleiobase/issue/GED-15
[GED-16]: https://linear.app/kleiobase/issue/GED-16
[GED-17]: https://linear.app/kleiobase/issue/GED-17
[GED-18]: https://linear.app/kleiobase/issue/GED-18
[GED-19]: https://linear.app/kleiobase/issue/GED-19
[GED-20]: https://linear.app/kleiobase/issue/GED-20
[GED-21]: https://linear.app/kleiobase/issue/GED-21
[GED-22]: https://linear.app/kleiobase/issue/GED-22
