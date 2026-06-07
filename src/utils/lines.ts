import type { Diagnostic, GedcomLineEnding, GedcomNode } from "../types.js";
import { ParseError } from "../errors/index.js";

const EOL_SEQUENCES: Record<GedcomLineEnding, string> = {
  LF: "\n",
  CRLF: "\r\n",
  CR: "\r"
};

interface ParsedLine {
  level: number;
  tag: string;
  value?: string;
  xref?: string;
  lineNumber: number;
}

// The tag/value separator is a single space (per the GEDCOM line grammar); any
// further whitespace belongs to the value. Using a greedy `\s+` here would strip
// significant leading spaces from line values, so only one delimiter space is
// consumed before the value capture.
const LINE_PATTERN = /^(\d+)\s+(?:(@[^@\s]+@)\s+)?([A-Z0-9_]+)(?: (.*))?$/;
const GEDCOM551_LINE_LIMIT = 255;

type ContinuationMode = "gedcom7" | "gedcom551";

interface StringifyOptions {
  mode: ContinuationMode;
  lineEnding?: GedcomLineEnding;
}

export function splitGedcomLines(input: string): string[] {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((line) => line.length > 0);
}

/** A physical GEDCOM line paired with its 1-based source line number. */
export interface NumberedLine {
  raw: string;
  lineNumber: number;
}

export function parseLine(line: string, lineNumber: number): ParsedLine | null {
  const match = line.match(LINE_PATTERN);

  if (!match) {
    return null;
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

/**
 * Assemble top-level GEDCOM records one at a time from a stream of numbered
 * lines, yielding each level-0 record subtree as soon as the next level-0 line
 * (or end of input) proves it complete. Diagnostics are pushed into the shared
 * `diagnostics` array as lines are consumed, so a record's diagnostics are
 * present before that record is yielded.
 *
 * This is the shared core behind both {@link parseGedcomTree} (which collects
 * every root) and the record streamer (which yields and discards one root at a
 * time, keeping peak memory at roughly the input plus a single record subtree).
 */
export function* streamGedcomRoots(
  lines: Iterable<NumberedLine>,
  diagnostics: Diagnostic[]
): Generator<GedcomNode> {
  let current: GedcomNode | undefined;
  const stack: GedcomNode[] = [];

  for (const { raw: rawLine, lineNumber } of lines) {
    const parsed = parseLine(rawLine, lineNumber);

    if (!parsed) {
      // A physical line with no level number: a value containing an unescaped
      // embedded newline (seen in some real-world exports). Recover by folding
      // it into the most recent node's value as a continuation, and flag it so
      // a strict caller can choose to treat it as fatal.
      const node = stack[stack.length - 1];
      if (node) {
        node.value = node.value === undefined ? rawLine : `${node.value}\n${rawLine}`;
        diagnostics.push({
          severity: "warning",
          code: "MALFORMED_LINE_RECOVERED",
          message: `Line ${lineNumber} has no level number; folded into the preceding ${node.tag} value as a continuation.`,
          location: { line: lineNumber, tag: node.tag }
        });
      } else {
        diagnostics.push({
          severity: "error",
          code: "MALFORMED_LINE_DROPPED",
          message: `Line ${lineNumber} has no level number and no preceding structure; dropped.`,
          location: { line: lineNumber }
        });
      }
      continue;
    }

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
      if (current) {
        yield current;
      }
      current = node;
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

  if (current) {
    yield current;
  }
}

export function parseGedcomTree(input: string): { roots: GedcomNode[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const numberedLines = splitGedcomLines(input).map(
    (raw, index): NumberedLine => ({ raw, lineNumber: index + 1 })
  );
  const roots = [...streamGedcomRoots(numberedLines, diagnostics)];

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
  // A leading @ is doubled (@@) so a reader doesn't mistake the payload for a
  // pointer — EXCEPT when the @ is structural and not a literal character:
  //  - a pointer payload such as `@I1@` (whole value is `@xref@`), and
  //  - a 5.5.1 escape sequence such as `@#DJULIAN@ …` (introduced by `@#`),
  //    which GEDCOM 7 does not use.
  if (mode === "gedcom551" && value.startsWith("@#")) {
    return value;
  }

  if (value.startsWith("@") && !/^@[^@\s]+@$/.test(value)) {
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
  const firstValue =
    firstSegments.length > 0 ? encodeLineString(firstSegments[0]!, "gedcom551") : undefined;

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

  const eol = EOL_SEQUENCES[options.lineEnding ?? "LF"];
  return `${lines.join(eol)}${eol}`;
}
