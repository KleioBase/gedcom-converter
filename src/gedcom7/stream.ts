import type { Diagnostic, GedcomNode, GedcomRecordStream, ParsedHeader, ParsedRecord } from "../types.js";
import { ParseError } from "../errors/index.js";
import { normalizeContinuationPayloads, streamGedcomRoots } from "../utils/lines.js";
import type { NumberedLine } from "../utils/lines.js";
import { buildGedcom7Header, toParsedRecord, validateGedcom7Line } from "./parser.js";
import { GEDCOM7_VERSION } from "./schema.js";
import { normalizeGedcom7Node } from "./normalization.js";

/**
 * Walk a decoded GEDCOM string one physical line at a time without splitting it
 * into an array first, so only the source string and the current record subtree
 * are retained. CR, LF, and CRLF are all treated as line breaks; a single
 * trailing line break does not produce an empty final line (matching the eager
 * parser), while any other blank line is surfaced for the validator to reject.
 */
function* physicalLines(text: string): Generator<NumberedLine> {
  const length = text.length;
  let start = 0;
  let lineNumber = 0;

  for (let index = 0; index < length; index += 1) {
    const code = text.charCodeAt(index);

    if (code !== 0x0a && code !== 0x0d) {
      continue;
    }

    lineNumber += 1;
    yield { raw: text.slice(start, index), lineNumber };

    if (code === 0x0d && index + 1 < length && text.charCodeAt(index + 1) === 0x0a) {
      index += 1;
    }

    start = index + 1;
  }

  if (start < length) {
    lineNumber += 1;
    yield { raw: text.slice(start), lineNumber };
  }
}

/** Validate each physical line as it is scanned, before it reaches the assembler. */
function* validatedGedcom7Lines(text: string): Generator<NumberedLine> {
  for (const line of physicalLines(text)) {
    validateGedcom7Line(line.raw, line.lineNumber);
    yield line;
  }
}

/** Normalize a single GEDCOM 7 root subtree exactly as the eager parser does. */
function normalizeGedcom7Root(node: GedcomNode): GedcomNode {
  return normalizeContinuationPayloads([normalizeGedcom7Node(node)], "gedcom7")[0]!;
}

class Gedcom7RecordStream implements GedcomRecordStream {
  public readonly version = GEDCOM7_VERSION;
  public readonly header: ParsedHeader;
  public readonly diagnostics: Diagnostic[] = [];

  private readonly roots: Generator<GedcomNode>;
  private consumed = false;

  public constructor(text: string) {
    // One validated-line generator feeds one root assembler; the header pull and
    // every subsequent record pull share this single forward-only cursor.
    this.roots = streamGedcomRoots(validatedGedcom7Lines(text), this.diagnostics);
    this.header = this.readHeader();
  }

  private readHeader(): ParsedHeader {
    const first = this.roots.next();

    if (first.done || first.value.tag !== "HEAD") {
      throw new ParseError("GEDCOM 7 document must begin with HEAD");
    }

    return buildGedcom7Header(normalizeGedcom7Root(first.value));
  }

  public [Symbol.iterator](): Iterator<ParsedRecord> {
    return this.iterate();
  }

  private *iterate(): Generator<ParsedRecord> {
    if (this.consumed) {
      return;
    }
    this.consumed = true;

    for (let next = this.roots.next(); !next.done; next = this.roots.next()) {
      const root = next.value;

      if (root.tag === "HEAD") {
        throw new ParseError("GEDCOM 7 document must contain exactly one HEAD");
      }

      if (root.tag === "TRLR") {
        if (root.value !== undefined || root.xref !== undefined || root.children.length > 0) {
          throw new ParseError("GEDCOM 7 TRLR must not have a payload, xref, or substructures");
        }

        if (!this.roots.next().done) {
          throw new ParseError("GEDCOM 7 document must end with TRLR");
        }

        return;
      }

      yield toParsedRecord(normalizeGedcom7Root(root));
    }

    throw new ParseError("GEDCOM 7 document must end with TRLR");
  }
}

/**
 * Create a lazy {@link GedcomRecordStream} over GEDCOM 7 text or bytes. The
 * input must already be GEDCOM 7; callers route HEAD/shape validation through
 * the same checks as {@link parseGedcom7}. The caller is expected to have
 * detected the version already (the public entry point validates it).
 */
export function streamGedcom7Records(text: string): GedcomRecordStream {
  return new Gedcom7RecordStream(text);
}
