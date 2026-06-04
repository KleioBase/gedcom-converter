# Release process

How `@kleiobase/gedcom-converter` is versioned and published.

## Versioning (SemVer)

The package follows [Semantic Versioning](https://semver.org/). Given the package's
job is GEDCOM fidelity, the public contract is **the exported API and the documented
conversion behaviour** (the [fidelity matrix](./fidelity-matrix.md) and diagnostic
codes).

- **MAJOR** — a breaking change to an exported type/function signature, or a change
  in conversion output that could break a consumer relying on the documented
  behaviour (e.g. a tag that previously round-tripped now degrades).
- **MINOR** — backwards-compatible additions: new exports, new conversion coverage,
  new diagnostic codes, new CLI subcommands.
- **PATCH** — backwards-compatible bug fixes that move output *toward* the documented
  behaviour, docs, and internal refactors.

A new or changed **diagnostic code** is MINOR. Removing or renaming one is MAJOR.

## Pre-release tags

Pre-releases use npm dist-tags and SemVer pre-release identifiers:

- `x.y.z-alpha.n` → published under the `alpha` tag — unstable, API may change.
- `x.y.z-beta.n` → `beta` tag — feature-complete, stabilising.
- `x.y.z-rc.n` → `rc` tag — release candidate; promote to `latest` if no issues.

Install a pre-release explicitly: `npm install @kleiobase/gedcom-converter@alpha`.

## Branching

- All releases are cut from `main`. `main` is always releasable (CI green).
- Work happens on `andresdenkberg/ged-<n>-…` branches and merges to `main` via PR.
- No long-lived release branches; hotfixes also land on `main` first, then release.

## Cutting a release

1. Ensure `main` is green: `npm ci && npm run typecheck && npm test && npm run build`.
2. Move the `## [Unreleased]` section of [`CHANGELOG.md`](../CHANGELOG.md) to a dated
   version heading and update the compare links.
3. Bump the version: `npm version <major|minor|patch>` (or `--preid alpha` for a
   pre-release). This creates the `vX.Y.Z` commit and tag.
4. Push: `git push --follow-tags origin main`.
5. CI publishes to npm with provenance (OIDC); for a pre-release add
   `--tag <alpha|beta|rc>`. Manual fallback: `npm publish --access public [--tag …]`.
6. Create the GitHub release from the tag, pasting the CHANGELOG section.
7. Verify: `npm install @kleiobase/gedcom-converter@<version>` in a clean project
   resolves and type-checks.

## Rolling back a bad release

npm does not allow re-publishing a version. To recover:

1. **Deprecate** the bad version so installs warn:
   `npm deprecate @kleiobase/gedcom-converter@X.Y.Z "broken release, use X.Y.(Z+1)"`.
2. If it is `latest` and harmful, repoint the tag to the last good version:
   `npm dist-tag add @kleiobase/gedcom-converter@<good> latest`.
3. Publish a fixed **patch** release (never reuse the bad number).
4. Unpublish is a last resort and only within npm's 72-hour window:
   `npm unpublish @kleiobase/gedcom-converter@X.Y.Z`.
