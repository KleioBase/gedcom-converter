import type { Diagnostic, GedcomNode } from "../../types.js";

// GED-13 — French Republican calendar validation. The 13 month tags and the
// `FRENCH_R` ↔ `@#DFRENCH R@` calendar identifier already pass through the date
// converters unchanged; this adds the spec §6.1 constraints that have no other
// home: the month must be one of the 13 known tags, and the calendar admits no
// epoch (it has no era marker — Republican year 1 is its own origin).

const FRENCH_REPUBLICAN_MONTHS = new Set([
  "VEND", // Vendémiaire
  "BRUM", // Brumaire
  "FRIM", // Frimaire
  "NIVO", // Nivôse
  "PLUV", // Pluviôse
  "VENT", // Ventôse
  "GERM", // Germinal
  "FLOR", // Floréal
  "PRAI", // Prairial
  "MESS", // Messidor
  "THER", // Thermidor
  "FRUC", // Fructidor
  "COMP" // Jour Complémentaires
]);

export const FRENCH_REPUBLICAN_MONTH_TAGS: readonly string[] = [...FRENCH_REPUBLICAN_MONTHS];

const DATE_KEYWORDS = new Set(["FROM", "TO", "BET", "AND", "BEF", "AFT", "ABT", "CAL", "EST", "INT"]);
const CALENDAR_KEYWORDS = new Set(["GREGORIAN", "JULIAN", "HEBREW", "FRENCH_R", "ROMAN", "UNKNOWN"]);

/** Normalise 5.5.1 `@#D…@` calendar escapes to their bare keyword form for tokenising. */
function normalizeCalendarEscapes(value: string): string {
  return value.replace(/@#D([A-Z]+(?:\s[A-Z]+)?)@/g, (_match, inner: string) => inner.replace(/\s+/g, "_"));
}

function withOptionalLocation(node: GedcomNode): { line?: number; tag: string } {
  return {
    tag: node.tag,
    ...(node.lineNumber !== undefined ? { line: node.lineNumber } : {})
  };
}

/** True when the (normalised) payload carries a BCE / B.C. era marker. */
function hasEpochMarker(normalized: string): boolean {
  return /\bBCE\b/.test(normalized) || /\bB\.?\s*C\.?(?!\w)/.test(normalized);
}

/**
 * Validate a date payload that uses the French Republican calendar. Emits a
 * warning diagnostic for any unrecognised month tag and for an illegal epoch
 * marker. The value itself is never rejected — the converter favours valid
 * output plus diagnostics over throwing. No-op for payloads that don't use
 * `FRENCH_R`, or that mix it with another calendar (ambiguous to validate).
 */
export function validateFrenchRepublicanDate(node: GedcomNode, value: string | undefined, diagnostics: Diagnostic[]): void {
  if (!value) {
    return;
  }

  const normalized = normalizeCalendarEscapes(value).toUpperCase();
  const tokens = normalized.split(/\s+/).filter((token) => token.length > 0);

  if (!tokens.includes("FRENCH_R")) {
    return;
  }

  const otherCalendar = tokens.some((token) => token !== "FRENCH_R" && CALENDAR_KEYWORDS.has(token));
  if (otherCalendar) {
    return;
  }

  const monthCandidates = tokens.filter(
    (token) => /^[A-Z][A-Z_]*$/.test(token) && !DATE_KEYWORDS.has(token) && !CALENDAR_KEYWORDS.has(token) && token !== "BCE"
  );

  for (const month of monthCandidates) {
    if (!FRENCH_REPUBLICAN_MONTHS.has(month)) {
      diagnostics.push({
        severity: "warning",
        code: "FRENCH_R_MONTH_INVALID",
        message: `"${month}" is not a valid French Republican month tag (expected one of ${FRENCH_REPUBLICAN_MONTH_TAGS.join(", ")}).`,
        location: withOptionalLocation(node)
      });
    }
  }

  if (hasEpochMarker(normalized)) {
    diagnostics.push({
      severity: "warning",
      code: "FRENCH_R_EPOCH_INVALID",
      message: `The French Republican calendar has no epoch; an era marker (BCE / B.C.) is not permitted (spec §6.1).`,
      location: withOptionalLocation(node)
    });
  }
}
