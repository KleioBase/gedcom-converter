// GED-20 — SCHMA extension-declaration helpers shared by both directions.
//
// GEDCOM 7 §1.5.1: a documented extension tag is declared in HEAD.SCHMA as
// `2 TAG <extTag> <URI>` — the tag's meaning is its URI, not its spelling. The
// payload of a TAG structure is therefore the tag followed by a single URI.
//
// GEDCOM 5.5.1 has no SCHMA. We preserve the declarations across a 5.5.1 hop as
// a `_SCHMA` HEAD block whose `_TAG` children carry the same `<tag> <URI>`
// payload, so a v7 → 5.5.1 → v7 round-trip keeps the real URIs intact.

/** Synthetic URI prefix used when a 5.5.1 `_TAG` has no documented URI of its own. */
export const SYNTHETIC_TAG_URI_BASE = "https://kleiobase.com/gedcom-converter/legacy-tag/";

export function syntheticTagUri(tag: string): string {
  return `${SYNTHETIC_TAG_URI_BASE}${tag}`;
}

export function isSyntheticTagUri(uri: string | undefined): boolean {
  return uri !== undefined && uri.startsWith(SYNTHETIC_TAG_URI_BASE);
}

/** Build a `TAG` payload: the extension tag followed by its URI. */
export function joinTagPayload(tag: string, uri: string): string {
  return `${tag} ${uri}`;
}

/** Parse a `TAG` payload (`<extTag> <URI>`) into its parts. */
export function splitTagPayload(value: string | undefined): { tag: string; uri?: string } | null {
  if (!value) {
    return null;
  }
  const match = value.trim().match(/^(\S+)(?:\s+(\S+))?$/);
  if (!match || !match[1]) {
    return null;
  }
  return { tag: match[1], ...(match[2] ? { uri: match[2] } : {}) };
}
