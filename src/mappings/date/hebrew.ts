import type { Diagnostic, GedcomNode } from "../../types.js";

// GED-12 — Hebrew calendar ADR (Adar I) / ADS (Adar II) leap-year resolution.
//
// The Hebrew calendar inserts a leap month (Adar I) in 7 of every 19 years. In a
// common (non-leap) year there is only one Adar, which the spec encodes as ADS
// (Adar II); ADR (Adar I) does not exist that year. GEDCOM 7 §6.1 recommends that
// a system which knows the leap-year status replace ADR with ADS in common years.

const HEBREW_MARKER = /(?:@#DHEBREW@|\bHEBREW\b)/;

/**
 * Hebrew leap years are those where Adar I is inserted: the 3rd, 6th, 8th, 11th,
 * 14th, 17th and 19th years of the 19-year Metonic cycle. Equivalent closed form:
 * `(7·year + 1) mod 19 < 7`.
 */
export function isHebrewLeapYear(year: number): boolean {
  return ((7 * year + 1) % 19) < 7;
}

function withOptionalLocation(node: GedcomNode): { line?: number; tag: string } {
  return {
    tag: node.tag,
    ...(node.lineNumber !== undefined ? { line: node.lineNumber } : {})
  };
}

/**
 * Replace `ADR` with `ADS` for any Hebrew-calendar date in a common year. The
 * month tag is always immediately followed by its year integer (`[day] ADR year`),
 * so each `ADR <year>` is resolved against that year's leap status. No-op for
 * payloads without a Hebrew calendar marker.
 */
export function resolveHebrewAdar(value: string | undefined): { value: string | undefined; corrected: boolean } {
  if (!value || !HEBREW_MARKER.test(value)) {
    return { value, corrected: false };
  }

  let corrected = false;
  const result = value.replace(/\bADR\b(\s+)(\d+)/g, (match, gap: string, yearText: string) => {
    const year = Number(yearText);
    if (Number.isFinite(year) && !isHebrewLeapYear(year)) {
      corrected = true;
      return `ADS${gap}${yearText}`;
    }
    return match;
  });

  return { value: result, corrected };
}

/**
 * Apply {@link resolveHebrewAdar} to a DATE node's payload, emitting an
 * informational diagnostic when a correction is made. Shared by both conversion
 * directions (the Hebrew marker and the ADR/ADS tags are identical lexically).
 */
export function applyHebrewAdarResolution(
  node: GedcomNode,
  value: string | undefined,
  diagnostics: Diagnostic[]
): string | undefined {
  const { value: resolved, corrected } = resolveHebrewAdar(value);

  if (corrected) {
    diagnostics.push({
      severity: "info",
      code: "HEBREW_ADAR_CORRECTED",
      message: `Replaced Hebrew ADR (Adar I) with ADS (Adar II) in a common (non-leap) year, per GEDCOM 7 §6.1.`,
      location: withOptionalLocation(node)
    });
  }

  return resolved;
}
