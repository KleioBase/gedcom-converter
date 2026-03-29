import type { Diagnostic, GedcomNode } from "../../types.js";

const DATE_CALENDAR_ESCAPES: Record<string, string> = {
  GREGORIAN: "@#DGREGORIAN@",
  JULIAN: "@#DJULIAN@",
  HEBREW: "@#DHEBREW@",
  FRENCH_R: "@#DFRENCH R@"
};

const V551_INLINE_PHRASE_PREFIXES = new Set(["FROM", "TO", "BET", "AFT", "BEF", "ABT", "CAL", "EST"]);

function withOptionalLocation(node: GedcomNode): { line?: number; tag: string } {
  return {
    tag: node.tag,
    ...(node.lineNumber !== undefined ? { line: node.lineNumber } : {})
  };
}

function convertCalendarKeywords(value: string): string {
  return value.replace(/\b(GREGORIAN|JULIAN|HEBREW|FRENCH_R)\b/g, (calendar) => DATE_CALENDAR_ESCAPES[calendar] ?? calendar);
}

function convertEpoch(value: string): string {
  return value.replace(/\bBCE\b/g, "B.C.");
}

function normalizeSpacing(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function canInlinePhrase(baseValue: string): boolean {
  const firstToken = normalizeSpacing(baseValue).split(" ")[0];
  return !V551_INLINE_PHRASE_PREFIXES.has(firstToken ?? "");
}

export function convertGedcom7DateValueTo551(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return normalizeSpacing(convertEpoch(convertCalendarKeywords(value)));
}

export function mapGedcom7DateNodeTo551(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const phraseNode = node.children.find((child) => child.tag === "PHRASE");
  const otherChildren = node.children.filter((child) => child.tag !== "PHRASE");
  const convertedValue = convertGedcom7DateValueTo551(node.value);

  let outputValue = convertedValue;

  if (phraseNode?.value) {
    if (!convertedValue || convertedValue.length === 0) {
      outputValue = `(${phraseNode.value})`;
    } else if (canInlinePhrase(convertedValue)) {
      outputValue = `INT ${convertedValue} (${phraseNode.value})`;
    } else {
      diagnostics.push({
        severity: "warning",
        code: "DATE_PHRASE_DEGRADED",
        message: "Preserved DATE value but could not inline the GEDCOM 7 PHRASE into a GEDCOM 5.5.1 DATE payload.",
        location: withOptionalLocation(node)
      });
    }
  }

  return {
    level: node.level,
    tag: "DATE",
    children: otherChildren,
    ...(outputValue !== undefined ? { value: outputValue } : {})
  };
}
