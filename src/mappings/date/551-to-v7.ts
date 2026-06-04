import type { Diagnostic, GedcomNode } from "../../types.js";
import { applyHebrewAdarResolution } from "./hebrew.js";

// Inverse of DATE_CALENDAR_ESCAPES in ./v7-to-551.ts. 5.5.1 wraps the calendar
// identifier in @#D…@; v7 prepends a bare keyword to the date payload. The
// French Republican escape literally embeds a space ("@#DFRENCH R@") so the
// pattern must accept it.
const DATE_CALENDAR_ESCAPE_TO_KEYWORD: Record<string, string> = {
  "@#DGREGORIAN@": "GREGORIAN",
  "@#DJULIAN@": "JULIAN",
  "@#DHEBREW@": "HEBREW",
  "@#DFRENCH R@": "FRENCH_R",
  "@#DROMAN@": "ROMAN",
  "@#DUNKNOWN@": "UNKNOWN"
};

const CALENDAR_ESCAPE_PATTERN = /@#D([A-Z]+(?:\s[A-Z]+)?)@/g;

function withOptionalLocation(node: GedcomNode): { line?: number; tag: string } {
  return {
    tag: node.tag,
    ...(node.lineNumber !== undefined ? { line: node.lineNumber } : {})
  };
}

function convertCalendarEscapes(
  value: string,
  diagnostics: Diagnostic[],
  node: GedcomNode
): { value: string; converted: boolean } {
  let converted = false;
  const result = value.replace(CALENDAR_ESCAPE_PATTERN, (match) => {
    const keyword = DATE_CALENDAR_ESCAPE_TO_KEYWORD[match];
    if (keyword) {
      converted = true;
      return keyword;
    }
    diagnostics.push({
      severity: "warning",
      code: "DATE_CALENDAR_ESCAPE_UNRECOGNIZED",
      message: `Preserved unrecognized GEDCOM 5.5.1 calendar escape ${match} in GEDCOM 7 DATE payload.`,
      location: withOptionalLocation(node)
    });
    return match;
  });
  return { value: result, converted };
}

function convertEpoch(value: string): { value: string; converted: boolean } {
  // Match B.C. (with or without trailing dot) as a standalone token following whitespace
  // or the start of the string. Avoid matching things like "B.C.E." which already mean BCE.
  let converted = false;
  const result = value.replace(/\b(?:B\.\s*C\.|B\.?\s*C)(?!\.E)\b\.?/gi, () => {
    converted = true;
    return "BCE";
  });
  return { value: result, converted };
}

function normalizeSpacing(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

interface ExtractedDatePhrase {
  /** The date portion that should remain in the DATE payload (may be empty). */
  date: string;
  /** The phrase extracted into a PHRASE substructure, if any. */
  phrase?: string;
  /** True when the source used the 5.5.1 `INT <date> (phrase)` interpreted form. */
  interpreted: boolean;
}

/**
 * GEDCOM 5.5.1 allowed free-text date phrases directly in the DATE payload:
 *
 *   - `INT <date> (<phrase>)` — an interpreted date, and
 *   - `(<phrase>)` — a bare date phrase with no machine-readable date.
 *
 * GEDCOM 7 removed both forms (§2.4 Note): phrases move to a PHRASE substructure
 * and the `INT` keyword no longer exists. This splits a 5.5.1 payload into the
 * date text that stays in the payload and the phrase that becomes `2 PHRASE …`.
 */
function extractDatePhrase(value: string): ExtractedDatePhrase {
  const trimmed = value.trim();

  // `INT <date> (<phrase>)` — interpreted date. The phrase is optional in
  // practice; if absent we simply drop the `INT` keyword and keep the date.
  const intMatch = /^INT\b\s*(.*)$/i.exec(trimmed);
  if (intMatch) {
    const remainder = intMatch[1] ?? "";
    const phraseMatch = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(remainder);
    if (phraseMatch) {
      return {
        date: (phraseMatch[1] ?? "").trim(),
        ...(phraseMatch[2] ? { phrase: phraseMatch[2].trim() } : {}),
        interpreted: true
      };
    }
    return { date: remainder.trim(), interpreted: true };
  }

  // `(<phrase>)` — a pure date phrase. The whole payload is the phrase and no
  // machine-readable date remains.
  const phraseOnly = /^\(([^)]*)\)$/.exec(trimmed);
  if (phraseOnly) {
    return {
      date: "",
      ...(phraseOnly[1] ? { phrase: phraseOnly[1].trim() } : {}),
      interpreted: false
    };
  }

  return { date: trimmed, interpreted: false };
}

export function convertGedcom551DateValueToV7(
  value: string | undefined,
  diagnostics: Diagnostic[],
  node: GedcomNode
): { value: string | undefined; calendarConverted: boolean; epochConverted: boolean } {
  if (value === undefined) {
    return { value: undefined, calendarConverted: false, epochConverted: false };
  }

  const calendar = convertCalendarEscapes(value, diagnostics, node);
  const epoch = convertEpoch(calendar.value);

  return {
    value: normalizeSpacing(epoch.value),
    calendarConverted: calendar.converted,
    epochConverted: epoch.converted
  };
}

export function mapGedcom551DateNodeToV7(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  // GEDCOM 5.5.1 permitted inline date phrases (`INT 1900 (about)` / `(about)`);
  // GEDCOM 7 moved them to a PHRASE substructure (§2.4). Split those out before
  // running the calendar/epoch normalisation, which only applies to the date.
  const phraseInfo = node.value !== undefined ? extractDatePhrase(node.value) : undefined;
  const dateToConvert = phraseInfo ? phraseInfo.date : node.value;

  const converted = convertGedcom551DateValueToV7(
    dateToConvert === "" ? undefined : dateToConvert,
    diagnostics,
    node
  );
  const { calendarConverted, epochConverted } = converted;
  const value = applyHebrewAdarResolution(node, converted.value, diagnostics);

  if (calendarConverted) {
    diagnostics.push({
      severity: "info",
      code: "DATE_CALENDAR_ESCAPE_CONVERTED",
      message: `Converted GEDCOM 5.5.1 calendar escape in DATE payload to GEDCOM 7 keyword form.`,
      location: withOptionalLocation(node)
    });
  }
  if (epochConverted) {
    diagnostics.push({
      severity: "info",
      code: "DATE_EPOCH_CONVERTED",
      message: `Converted GEDCOM 5.5.1 epoch marker B.C. in DATE payload to GEDCOM 7 BCE.`,
      location: withOptionalLocation(node)
    });
  }

  const children = [...node.children];

  if (phraseInfo?.phrase && !children.some((child) => child.tag === "PHRASE")) {
    diagnostics.push({
      severity: "info",
      code: phraseInfo.interpreted ? "DATE_INT_CONVERTED" : "DATE_PHRASE_EXTRACTED",
      message: phraseInfo.interpreted
        ? `Converted GEDCOM 5.5.1 interpreted date to a GEDCOM 7 DATE payload with a PHRASE substructure.`
        : `Moved GEDCOM 5.5.1 inline date phrase into a GEDCOM 7 PHRASE substructure.`,
      location: withOptionalLocation(node)
    });
    children.push({
      level: node.level + 1,
      tag: "PHRASE",
      value: phraseInfo.phrase,
      children: []
    });
  } else if (phraseInfo?.interpreted) {
    diagnostics.push({
      severity: "info",
      code: "DATE_INT_CONVERTED",
      message: `Dropped GEDCOM 5.5.1 interpreted-date \`INT\` keyword while converting to a GEDCOM 7 DATE payload.`,
      location: withOptionalLocation(node)
    });
  }

  return {
    level: node.level,
    tag: "DATE",
    children,
    ...(value !== undefined ? { value } : {})
  };
}
