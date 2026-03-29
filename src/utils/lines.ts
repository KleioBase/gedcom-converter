import type { Diagnostic, GedcomNode } from "../types.js";
import { ParseError } from "../errors/index.js";

interface ParsedLine {
  level: number;
  tag: string;
  value?: string;
  xref?: string;
  lineNumber: number;
}

const LINE_PATTERN = /^(\d+)\s+(?:(@[^@\s]+@)\s+)?([A-Z0-9_]+)(?:\s+(.*))?$/;
const GEDCOM551_LINE_LIMIT = 255;

type ContinuationMode = "gedcom7" | "gedcom551";

interface StringifyOptions {
  mode: ContinuationMode;
}

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

function supportsContinuationTag(tag: string, mode: ContinuationMode): boolean {
  return tag === "CONT" || (mode === "gedcom551" && tag === "CONC");
}

export function normalizeContinuationPayloads(nodes: GedcomNode[], mode: ContinuationMode): GedcomNode[] {
  return nodes.map((node) => {
    let continuationIndex = 0;
    let combinedValue = node.value ?? "";

    while (
      continuationIndex < node.children.length &&
      !node.children[continuationIndex]!.xref &&
      supportsContinuationTag(node.children[continuationIndex]!.tag, mode)
    ) {
      const continuationNode = node.children[continuationIndex]!;

      if (continuationNode.tag === "CONT") {
        combinedValue = `${combinedValue}\n${continuationNode.value ?? ""}`;
      } else {
        combinedValue = `${combinedValue}${continuationNode.value ?? ""}`;
      }

      continuationIndex += 1;
    }

    const remainingChildren = node.children
      .slice(continuationIndex)
      .map((child) => normalizeContinuationPayloads([child], mode)[0]!);

    return {
      ...node,
      children: remainingChildren,
      ...((node.value !== undefined || continuationIndex > 0) ? { value: combinedValue } : {})
    };
  });
}

function encodeLineString(value: string, mode: ContinuationMode): string {
  if (value.startsWith("@")) {
    return `@${value}`;
  }

  return value;
}

function formatLine(level: number, tag: string, value: string | undefined, xref?: string): string {
  const prefixParts = [String(level)];

  if (xref) {
    prefixParts.push(xref);
  }

  prefixParts.push(tag);

  if (value === undefined || value.length === 0) {
    return prefixParts.join(" ");
  }

  return `${prefixParts.join(" ")} ${value}`;
}

function splitGedcom551Segment(value: string, prefixLength: number): string[] {
  if (value.length === 0) {
    return [""];
  }

  const maxValueLength = Math.max(1, GEDCOM551_LINE_LIMIT - prefixLength - 1);
  const chunks: string[] = [];
  let remaining = value;

  while (remaining.length > maxValueLength) {
    let splitIndex = maxValueLength;

    while (splitIndex > 0 && remaining[splitIndex - 1] === " ") {
      splitIndex -= 1;
    }

    if (splitIndex === 0) {
      splitIndex = maxValueLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex);
  }

  chunks.push(remaining);

  return chunks;
}

function emitGedcom7Node(lines: string[], node: GedcomNode): void {
  const payloadLines = node.value !== undefined ? node.value.split("\n") : [];
  const firstValue = payloadLines.length > 0 ? encodeLineString(payloadLines[0]!, "gedcom7") : undefined;

  lines.push(formatLine(node.level, node.tag, firstValue, node.xref));

  for (const continuationValue of payloadLines.slice(1)) {
    lines.push(formatLine(node.level + 1, "CONT", encodeLineString(continuationValue, "gedcom7"), undefined));
  }

  for (const child of node.children) {
    emitGedcom7Node(lines, child);
  }
}

function emitGedcom551Node(lines: string[], node: GedcomNode): void {
  const payloadLines = node.value !== undefined ? node.value.split("\n") : [];
  const basePrefixLength = formatLine(node.level, node.tag, undefined, node.xref).length;
  const firstSegments =
    payloadLines.length > 0 ? splitGedcom551Segment(payloadLines[0]!, basePrefixLength) : [];
  const firstValue = firstSegments.length > 0 ? firstSegments[0]! : undefined;

  lines.push(formatLine(node.level, node.tag, firstValue, node.xref));

  for (const continuation of firstSegments.slice(1)) {
    lines.push(formatLine(node.level + 1, "CONC", encodeLineString(continuation, "gedcom551"), undefined));
  }

  for (const payloadLine of payloadLines.slice(1)) {
    const contPrefixLength = formatLine(node.level + 1, "CONT", undefined, undefined).length;
    const segments = splitGedcom551Segment(payloadLine, contPrefixLength);

    lines.push(formatLine(node.level + 1, "CONT", encodeLineString(segments[0]!, "gedcom551"), undefined));

    for (const continuation of segments.slice(1)) {
      lines.push(formatLine(node.level + 1, "CONC", encodeLineString(continuation, "gedcom551"), undefined));
    }
  }

  for (const child of node.children) {
    emitGedcom551Node(lines, child);
  }
}

export function stringifyGedcomTree(nodes: GedcomNode[], options: StringifyOptions): string {
  const lines: string[] = [];

  for (const node of nodes) {
    if (options.mode === "gedcom7") {
      emitGedcom7Node(lines, node);
    } else {
      emitGedcom551Node(lines, node);
    }
  }

  return `${lines.join("\n")}\n`;
}
