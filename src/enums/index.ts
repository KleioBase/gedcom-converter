// Centralised GEDCOM 7 enumeration sets and the bidirectional resolution helper
// used by both conversion directions. This module is the single source of truth
// for "what values are valid for enum tag X in v7"; the mappers in
// `src/mappings/*` consume these sets instead of redeclaring them inline.
//
// Reference: GEDCOM 7.0.18 spec §3.4 "Enumeration sets". 5.5.1 stored many of
// these enums with different casing (lowercase) or with no value validation at
// all, so the up-conversion (5.5.1 → v7) normalises towards these sets and falls
// back to `OTHER` + `PHRASE` (where the set permits `OTHER`) for anything it can
// not map. The down-conversion (v7 → 5.5.1) reverses the casing and humanises
// `OTHER` + `PHRASE` back to free text.

// --- enumeration sets (§3.4) -------------------------------------------------

/** g7:enumset-ADOP — which parent(s) an adoption applies to. */
export const ADOP = new Set(["HUSB", "WIFE", "BOTH"]);

/**
 * g7:enumset-EVENATTR — the attribute-vs-event discriminator carried by a
 * generic `NO`/event type. Open in practice but the spec names this closed set.
 */
export const EVENATTR = new Set(["CENS", "NCHI", "RESI", "FACT", "EVEN"]);

/** g7:enumset-MEDI — multimedia/source media type. */
export const MEDI = new Set([
  "AUDIO",
  "BOOK",
  "CARD",
  "ELECTRONIC",
  "FICHE",
  "FILM",
  "MAGAZINE",
  "MANUSCRIPT",
  "MAP",
  "NEWSPAPER",
  "PHOTO",
  "TOMBSTONE",
  "VIDEO",
  "OTHER"
]);

/** g7:enumset-PEDI — pedigree linkage type. 5.5.1 stored these lowercase. */
export const PEDI = new Set(["ADOPTED", "BIRTH", "FOSTER", "SEALING", "OTHER"]);

/** g7:enumset-QUAY — certainty assessment. Identical digits in both versions. */
export const QUAY = new Set(["0", "1", "2", "3"]);

/** g7:enumset-RESN — restriction notice. A comma-separated list in both versions. */
export const RESN = new Set(["CONFIDENTIAL", "LOCKED", "PRIVACY"]);

/** g7:enumset-ROLE — role in an event/citation. */
export const ROLE = new Set([
  "CHIL",
  "CLERGY",
  "FATH",
  "FRIEND",
  "GODP",
  "HUSB",
  "MOTH",
  "MULTIPLE",
  "NGHBR",
  "OFFICIATOR",
  "PARENT",
  "SPOU",
  "WIFE",
  "WITN",
  "OTHER"
]);

/** g7:enumset-SEX — biological sex. v7 adds `X`; 5.5.1 only had M/F/U. */
export const SEX = new Set(["M", "F", "X", "U"]);

/** g7:enumset-FAMC-STAT — child-to-family link assessment. v7-only. */
export const FAMC_STAT = new Set(["CHALLENGED", "DISPROVEN", "PROVEN"]);

/** g7:enumset-ord-STAT — LDS ordinance status. */
export const ORD_STAT = new Set([
  "BIC",
  "CANCELED",
  "CHILD",
  "COMPLETED",
  "DNS",
  "DNS_CAN",
  "EXCLUDED",
  "INFANT",
  "PRE_1970",
  "STILLBORN",
  "SUBMITTED",
  "UNCLEARED"
]);

/** g7:enumset-NAME-TYPE — personal-name type. */
export const NAME_TYPE = new Set(["AKA", "BIRTH", "IMMIGRANT", "MAIDEN", "MARRIED", "PROFESSIONAL", "OTHER"]);

/**
 * g7:enumset-EVEN — the generic event-type discriminator is intentionally
 * open-ended (any tag-shaped token is permitted and clarified via PHRASE), so it
 * has no closed value set. Exposed as `null` to keep the registry complete.
 */
export const EVEN = null;

/** Every closed enum set, keyed by its g7 enumset id, for iteration in tests. */
export const GEDCOM7_ENUM_SETS = {
  "ADOP": ADOP,
  "EVENATTR": EVENATTR,
  "MEDI": MEDI,
  "PEDI": PEDI,
  "QUAY": QUAY,
  "RESN": RESN,
  "ROLE": ROLE,
  "SEX": SEX,
  "FAMC-STAT": FAMC_STAT,
  "ord-STAT": ORD_STAT,
  "NAME-TYPE": NAME_TYPE
} as const;

/** Sets that include an `OTHER` member, so an unmatched value may fall back to `OTHER` + `PHRASE`. */
export const OTHER_BEARING_SETS: ReadonlySet<ReadonlySet<string>> = new Set([MEDI, PEDI, ROLE, NAME_TYPE]);

// --- 5.5.1 alias tables ------------------------------------------------------

/**
 * 5.5.1 name-type values that need aliasing onto the v7 enum. Inverse handling
 * (v7 → 5.5.1 case-folding) lives in `mapGedcom7NameTypeTo551` in v7-to-551.ts.
 */
export const NAME_TYPE_ALIASES: Record<string, string> = {
  AKA: "AKA",
  ALSO_KNOWN_AS: "AKA",
  ALIAS: "AKA",
  BIRTH: "BIRTH",
  IMMIGRANT: "IMMIGRANT",
  IMMIGRATION: "IMMIGRANT",
  MAIDEN: "MAIDEN",
  MARRIED: "MARRIED",
  PROFESSIONAL: "PROFESSIONAL",
  PROFESSION: "PROFESSIONAL",
  OTHER: "OTHER"
};

/**
 * 5.5.1 stored roles as free text (`Father`, `Godparent`, …). This maps the
 * separator-stripped, upper-cased text onto the v7 ROLE enum. Keep in sync with
 * ROLE_TEXT_ALIASES (the inverse, enum → text) in v7-to-551.ts.
 */
export const ROLE_TEXT_ALIASES: Record<string, string> = {
  CHILD: "CHIL",
  CLERGY: "CLERGY",
  FATHER: "FATH",
  FRIEND: "FRIEND",
  GODPARENT: "GODP",
  HUSBAND: "HUSB",
  MOTHER: "MOTH",
  MULTIPLE: "MULTIPLE",
  NEIGHBOR: "NGHBR",
  OFFICIATOR: "OFFICIATOR",
  PARENT: "PARENT",
  SPOUSE: "SPOU",
  WIFE: "WIFE",
  WITNESS: "WITN"
};

// --- normalisation + resolution ----------------------------------------------

/** Default token normalisation: trim, upper-case, collapse spaces/hyphens to `_`. */
export function normalizeEnumToken(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

/** Aggressive normalisation for ROLE text: drop all separators (`God Parent` → `GODPARENT`). */
export function normalizeRoleToken(value: string): string {
  return value.trim().toUpperCase().replace(/[\s_-]+/g, "");
}

export interface EnumResolution {
  /** The enum token to emit: either the matched member or `OTHER`. */
  enum: string;
  /** Present only when the value could not be matched and fell back to `OTHER`. */
  phrase?: string;
  /** True when `enum` is a direct or aliased member of the set. */
  matched: boolean;
}

export interface EnumOrPhraseOptions {
  /** Optional alias table consulted (on the normalised token) before the set itself. */
  aliases?: Record<string, string>;
  /** Token normaliser. Defaults to {@link normalizeEnumToken}. */
  normalize?: (value: string) => string;
  /** Fallback enum value when unmatched. Defaults to `OTHER`. */
  fallback?: string;
}

/**
 * Resolve a raw value against a v7 enum set.
 *
 * - Returns the matched enum (`matched: true`) when the normalised/aliased value
 *   is a member of `allowed`.
 * - Otherwise returns `{ enum: fallback, phrase: <original raw>, matched: false }`
 *   so the caller can emit `OTHER` + a `PHRASE` substructure carrying the
 *   original text. Only meaningful for {@link OTHER_BEARING_SETS}; callers for
 *   other sets should inspect `matched` and choose a set-specific fallback.
 */
export function enumOrPhrase(
  raw: string | undefined,
  allowed: ReadonlySet<string>,
  options: EnumOrPhraseOptions = {}
): EnumResolution {
  const { aliases, normalize = normalizeEnumToken, fallback = "OTHER" } = options;
  const source = raw?.trim() ?? "";
  const normalized = normalize(source);

  const aliased = aliases?.[normalized];
  if (aliased && allowed.has(aliased)) {
    return { enum: aliased, matched: true };
  }

  if (allowed.has(normalized)) {
    return { enum: normalized, matched: true };
  }

  return { enum: fallback, phrase: source, matched: false };
}
