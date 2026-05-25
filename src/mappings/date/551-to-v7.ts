import type { Diagnostic, GedcomNode } from "../../types.js";

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
  const { value, calendarConverted, epochConverted } = convertGedcom551DateValueToV7(node.value, diagnostics, node);

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

  return {
    level: node.level,
    tag: "DATE",
    children: node.children,
    ...(value !== undefined ? { value } : {})
  };
}
