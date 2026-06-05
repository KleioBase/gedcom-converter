# Release process

This document describes how `@kleiobase/gedcom-converter` is versioned and
published.

## Versioning (SemVer)

The package follows [Semantic Versioning](https://semver.org/). Because its
purpose is GEDCOM fidelity, the public contract is the exported API together with
the documented conversion behaviour (the [fidelity matrix](./fidelity-matrix.md)
and the diagnostic codes).

- **MAJOR**: a breaking change to an exported type or function signature, or a
  change in conversion output that could break a consumer relying on the
  documented behaviour, such as a tag that previously round-tripped now being
  degraded.
- **MINOR**: a backwards-compatible addition, such as a new export, additional
  conversion coverage, a new diagnostic code, or a new CLI subcommand.
- **PATCH**: a backwards-compatible bug fix that moves output toward the
  documented behaviour, a documentation change, or an internal refactor.

A new or changed diagnostic code is a MINOR change. Removing or renaming one is a
MAJOR change.

## Pre-release tags

Pre-releases use npm dist-tags and SemVer pre-release identifiers:

- `x.y.z-alpha.n` is published under the `alpha` tag. The API is unstable and may
  change.
- `x.y.z-beta.n` is published under the `beta` tag. The feature set is complete
  and stabilising.
- `x.y.z-rc.n` is published under the `rc` tag. It is a release candidate and is
  promoted to `latest` if no issues are found.

Install a pre-release explicitly with
`npm install @kleiobase/gedcom-converter@alpha`.

## Branching

- All releases are cut from `main`, which is always releasable (CI green).
- Work happens on feature branches and merges to `main` through a pull request.
- There are no long-lived release branches. Hotfixes also land on `main` first
  and are released from there.

## Cutting a release

1. Confirm `main` is green: `npm ci && npm run typecheck && npm test && npm run build`.
2. Move the `## [Unreleased]` section of [`CHANGELOG.md`](../CHANGELOG.md) to a
   dated version heading and update the comparison links.
3. Bump the version with `npm version <major|minor|patch>` (add `--preid alpha`
   for a pre-release). This creates the `vX.Y.Z` commit and tag. Also update
   `DEFAULT_PRODUCT_VERSION` in `src/gedcom551/serializer.ts` to match: it is
   stamped into the generated `HEAD.SOUR.VERS` and is not derived from
   `package.json`.
4. Push the commit and tag: `git push --follow-tags origin main`.
5. CI publishes to npm with provenance (OIDC). For a pre-release, add
   `--tag <alpha|beta|rc>`. The manual fallback is
   `npm publish --access public [--tag …]`.
6. Create the GitHub release from the tag and paste in the CHANGELOG section.
7. Verify the result: `npm install @kleiobase/gedcom-converter@<version>` in a
   clean project resolves and type-checks.

## Rolling back a bad release

npm does not allow re-publishing a version. To recover:

1. Deprecate the bad version so that installs warn:
   `npm deprecate @kleiobase/gedcom-converter@X.Y.Z "broken release, use X.Y.(Z+1)"`.
2. If it is tagged `latest` and is harmful, repoint the tag to the last good
   version: `npm dist-tag add @kleiobase/gedcom-converter@<good> latest`.
3. Publish a fixed patch release. Never reuse the bad version number.
4. Unpublish only as a last resort, and only within npm's 72-hour window:
   `npm unpublish @kleiobase/gedcom-converter@X.Y.Z`.
