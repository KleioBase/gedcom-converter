import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { convertGedcom, parseGedcom, stringifyGedcom, stringifyGedcomZip } from "../src/index.js";
import { readZipEntries } from "../src/gedzip/zip.js";
import { decodeInput } from "../src/utils/text.js";
import type { GedcomNode, ParsedRecord } from "../src/types.js";

// character-encoding + line-ending round-trip.

function fixtureBytes(name: string): Uint8Array {
  return readFileSync(resolve(process.cwd(), "fixtures", name));
}

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

/** Encode a JS string as UTF-16 bytes with the given endianness and a BOM. */
function toUtf16(text: string, endian: "LE" | "BE"): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  if (endian === "LE") {
    out[0] = 0xff;
    out[1] = 0xfe;
  } else {
    out[0] = 0xfe;
    out[1] = 0xff;
  }
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const hi = (code >> 8) & 0xff;
    const lo = code & 0xff;
    out[2 + i * 2] = endian === "LE" ? lo : hi;
    out[2 + i * 2 + 1] = endian === "LE" ? hi : lo;
  }
  return out;
}

/** Strip parser line numbers so two parses can be compared structurally. */
function stripLineNumbers(node: GedcomNode): GedcomNode {
  const { lineNumber: _lineNumber, ...rest } = node;
  return { ...rest, children: node.children.map(stripLineNumbers) };
}

function recordShape(record: ParsedRecord) {
  return { ...record, children: record.children.map(stripLineNumbers) };
}

describe("line-ending serializer option", () => {
  const document = parseGedcom(decodeInput(fixtureBytes("minimal-7.0.18.ged")), { version: "7.0.18" });

  it("defaults to LF", () => {
    const output = stringifyGedcom(document, { version: "7.0.18" });
    expect(output).not.toContain("\r");
    expect(output.endsWith("\n")).toBe(true);
  });

  it("emits CRLF on demand", () => {
    const output = stringifyGedcom(document, { version: "7.0.18", lineEnding: "CRLF" });
    expect(output).toContain("\r\n");
    expect(output.split("\r\n").length).toBeGreaterThan(1);
    // No lone LF outside a CRLF pair.
    expect(/[^\r]\n/.test(output)).toBe(false);
  });

  it("emits bare CR on demand", () => {
    const output = stringifyGedcom(document, { version: "7.0.18", lineEnding: "CR" });
    expect(output).toContain("\r");
    expect(output).not.toContain("\n");
  });

  it("a CRLF document re-parses to the same records as the LF form", () => {
    const lf = stringifyGedcom(document, { version: "7.0.18", lineEnding: "LF" });
    const crlf = stringifyGedcom(document, { version: "7.0.18", lineEnding: "CRLF" });
    const lfRecords = parseGedcom(lf, { version: "7.0.18" }).records.map(recordShape);
    const crlfRecords = parseGedcom(crlf, { version: "7.0.18" }).records.map(recordShape);
    expect(crlfRecords).toEqual(lfRecords);
  });
});

describe("byte-order mark serializer option", () => {
  const document = parseGedcom(decodeInput(fixtureBytes("minimal-7.0.18.ged")), { version: "7.0.18" });
  const BOM = "\uFEFF";

  it("prefixes GEDCOM 7 output with U+FEFF", () => {
    // Spec §1.1 p.9: "The first character in each data stream should be U+FEFF."
    const output = stringifyGedcom(document, { version: "7.0.18" });

    expect(output.startsWith(BOM)).toBe(true);
    expect([...new TextEncoder().encode(output).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("suppresses it on request, leaving the rest of the stream identical", () => {
    const withBom = stringifyGedcom(document, { version: "7.0.18" });
    const without = stringifyGedcom(document, { version: "7.0.18", bom: false });

    expect(without.startsWith(BOM)).toBe(false);
    expect(without).toBe(withBom.slice(BOM.length));
  });

  it("omits it from 5.5.1 output by default, but emits one on request", () => {
    // 5.5.1 permits a BOM on UTF-8 but its ANSEL/ASCII-era readers may not, so
    // the default is off; the option is there for consumers that want one.
    expect(stringifyGedcom(document, { version: "5.5.1" }).startsWith(BOM)).toBe(false);
    expect(stringifyGedcom(document, { version: "5.5.1", bom: true }).startsWith(BOM)).toBe(true);
  });

  it("applies to convertGedcom too, so both entry points still agree", () => {
    const source = readFileSync(resolve(process.cwd(), "fixtures", "minimal-7.0.18.ged"), "utf8");

    expect(convertGedcom(source, { from: "7.0.18", to: "7.0.18" }).output).toBe(
      stringifyGedcom(document, { version: "7.0.18" })
    );
  });

  it("prefixes the gedcom.ged entry inside a GEDZIP archive", async () => {
    // The archive member is written internally, so a caller cannot add one itself.
    const archive = await stringifyGedcomZip(document, new Map(), { version: "7.0.18" });
    const dataset = (await readZipEntries(archive)).find((entry) => entry.name === "gedcom.ged")!;

    expect([...dataset.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("re-parses to the same records, as text and as bytes", () => {
    const output = stringifyGedcom(document, { version: "7.0.18" });
    const expected = document.records.map(recordShape);

    expect(parseGedcom(output).records.map(recordShape)).toEqual(expected);
    expect(parseGedcom(new TextEncoder().encode(output)).records.map(recordShape)).toEqual(expected);
    expect(stringifyGedcom(parseGedcom(output), { version: "7.0.18" })).toBe(output);
  });
});

describe("UTF-16 decoding (LE and BE, with BOM)", () => {
  const text = "0 HEAD\n1 CHAR UNICODE\n0 @I1@ INDI\n1 NAME José /Müller/\n0 TRLR\n";

  it("decodes UTF-16LE", () => {
    expect(decodeInput(toUtf16(text, "LE"))).toBe(text);
  });

  it("decodes UTF-16BE", () => {
    expect(decodeInput(toUtf16(text, "BE"))).toBe(text);
  });
});

describe("ASCII decoding", () => {
  it("decodes an ASCII-declared stream as UTF-8 (its superset)", () => {
    const bytes = Uint8Array.from(ascii("0 HEAD\n1 CHAR ASCII\n0 @I1@ INDI\n1 NAME John /Doe/\n0 TRLR\n"));
    const decoded = decodeInput(bytes);
    expect(decoded).toContain("1 NAME John /Doe/");
    const document = parseGedcom(decoded, { version: "5.5.1" });
    expect(document.records[0]?.tag).toBe("INDI");
  });
});

describe("CR and LF variants of the torture fixture yield identical IR", () => {
  it("TGC551.ged (CR) and TGC551LF.ged (LF) parse to the same records", () => {
    const cr = parseGedcom(decodeInput(fixtureBytes("official/gedcom551/TGC551.ged")), { version: "5.5" });
    const lf = parseGedcom(decodeInput(fixtureBytes("official/gedcom551/TGC551LF.ged")), { version: "5.5" });
    expect(cr.records.length).toBe(lf.records.length);
    expect(cr.records.map(recordShape)).toEqual(lf.records.map(recordShape));
  });
});

describe("ANSEL-encoded fixture decodes to expected accented characters", () => {
  it("decodes the copyright sign and leaves no replacement characters in known text", () => {
    const decoded = decodeInput(fixtureBytes("official/gedcom551/TGC551LF.ged"));
    expect(decoded).toContain("© 1997 by H. Eichmann");
  });
});
