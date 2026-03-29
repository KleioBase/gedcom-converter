import type { Diagnostic, GedcomNode } from "../types.js";
import { ParseError } from "../errors/index.js";
import { isXrefToken } from "./xref.js";

interface ParsedLine {
  level: number;
  tag: string;
  value?: string;
  xref?: string;
  lineNumber: number;
}

const LINE_PATTERN = /^(\d+)\s+(?:(@[^@\s]+@)\s+)?([A-Z0-9_]+)(?:\s+(.*))?$/;

export function splitGedcomLines(input: string): string[] {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((line) => line.length > 0);
}

function parseLine(line: string, lineNumber: number): ParsedLine {
  const match = line.match(LINE_PATTERN);

  if (!match) {
    throw new ParseError(`Invalid GEDCOM line at ${lineNumber}: ${line}`);
  }

  const [, levelText, possibleXref, tag, possibleValue] = match;

  return {
    level: Number(levelText),
    ...(possibleXref ? { xref: possibleXref } : {}),
    tag: tag ?? "",
    ...(typeof possibleValue === "string" ? { value: possibleValue } : {}),
    lineNumber
  };
}

export function parseGedcomTree(input: string): { roots: GedcomNode[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const roots: GedcomNode[] = [];
  const stack: GedcomNode[] = [];

  for (const [index, rawLine] of splitGedcomLines(input).entries()) {
    const lineNumber = index + 1;
    const parsed = parseLine(rawLine, lineNumber);
    const node: GedcomNode = {
      level: parsed.level,
      tag: parsed.tag,
      children: [],
      lineNumber: parsed.lineNumber,
      ...(parsed.value !== undefined ? { value: parsed.value } : {}),
      ...(parsed.xref !== undefined ? { xref: parsed.xref } : {})
    };

    while (stack.length > 0 && stack[stack.length - 1]!.level >= node.level) {
      stack.pop();
    }

    if (node.level === 0) {
      roots.push(node);
      stack.length = 0;
      stack.push(node);
      continue;
    }

    const parent = stack[stack.length - 1];

    if (!parent) {
      throw new ParseError(`Missing parent structure before line ${lineNumber}`);
    }

    if (node.level !== parent.level + 1) {
      diagnostics.push({
        severity: "warning",
        code: "NON_CONTIGUOUS_LEVEL",
        message: `Line ${lineNumber} jumps from level ${parent.level} to ${node.level}.`,
        location: { line: lineNumber, tag: node.tag }
      });
    }

    parent.children.push(node);
    stack.push(node);
  }

  return { roots, diagnostics };
}

export function stringifyGedcomTree(nodes: GedcomNode[]): string {
  const lines: string[] = [];

  const visit = (node: GedcomNode): void => {
    const parts = [String(node.level)];

    if (node.xref) {
      parts.push(node.xref);
    }

    parts.push(node.tag);

    if (typeof node.value === "string" && node.value.length > 0) {
      parts.push(node.value);
    } else if (typeof node.value === "string" && node.value.length === 0 && !isXrefToken(node.value)) {
      parts.push("");
    }

    lines.push(parts.join(" ").trimEnd());

    for (const child of node.children) {
      visit(child);
    }
  };

  for (const node of nodes) {
    visit(node);
  }

  return `${lines.join("\n")}\n`;
}
