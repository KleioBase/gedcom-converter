import { describe, expect, it } from "vitest";
import { parseGedcom, streamGedcomRecords } from "../src/index.js";
import type { ParsedRecord } from "../src/index.js";
import { readFixture } from "./helpers.js";

const MINIMAL_7 = `0 HEAD
1 SOUR Demo App
1 GEDC
2 VERS 7.0.18
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Ada /Lovelace/
1 BIRT
2 DATE 10 DEC 1815
0 @N1@ SNOTE Shared note
1 CONT second line
0 _CUSTOM custom extension record
0 TRLR`;

describe("streamGedcomRecords", () => {
  it("exposes the parsed header before iteration begins", () => {
    const stream = streamGedcomRecords(MINIMAL_7);

    expect(stream.version).toBe("7.0.18");
    expect(stream.header.gedcomVersion).toBe("7.0.18");
    expect(stream.header.sourceSystem).toBe("Demo App");
    expect(stream.header.characterSet).toBe("UTF-8");
    expect(stream.header.raw.tag).toBe("HEAD");
  });

  it("yields every top-level record after HEAD and before TRLR, TRLR excluded", () => {
    const records = [...streamGedcomRecords(MINIMAL_7)];

    expect(records.map((record) => record.tag)).toEqual(["INDI", "SNOTE", "_CUSTOM"]);
    expect(records.some((record) => record.tag === "HEAD")).toBe(false);
    expect(records.some((record) => record.tag === "TRLR")).toBe(false);
  });

  it("builds each record subtree on demand (one per .next())", () => {
    const iterator = streamGedcomRecords(MINIMAL_7)[Symbol.iterator]();

    const first = iterator.next();
    expect(first.done).toBe(false);
    expect(first.value.tag).toBe("INDI");
    expect(first.value.xref).toBe("@I1@");
    expect(first.value.children.map((child) => child.tag)).toEqual(["NAME", "BIRT"]);

    const second = iterator.next();
    expect(second.value.tag).toBe("SNOTE");
    // CONT continuation folded into the value, as in parseGedcom.
    expect(second.value.value).toBe("Shared note\nsecond line");
  });

  it("matches parseGedcom record-for-record", () => {
    const batch = parseGedcom(MINIMAL_7, { version: "7.0.18" });
    const streamed = [...streamGedcomRecords(MINIMAL_7, { version: "7.0.18" })];

    const batchTopLevel: ParsedRecord[] = [
      ...batch.records,
      ...batch.extensions.map((node) => ({
        tag: node.tag,
        children: node.children,
        ...(node.xref !== undefined ? { xref: node.xref } : {}),
        ...(node.value !== undefined ? { value: node.value } : {})
      }))
    ];

    expect(streamed).toEqual(batchTopLevel);
  });

  it("collects diagnostics, fully populated once the iterator is exhausted", () => {
    // A level jump (1 -> 3) is valid line syntax but a non-contiguous level,
    // surfaced as a diagnostic rather than thrown — the same as parseGedcom.
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 BIRT
3 DATE 10 DEC 1815
0 TRLR`;

    const stream = streamGedcomRecords(input);

    expect(stream.diagnostics).toHaveLength(0);
    const records = [...stream];

    expect(records).toHaveLength(1);
    expect(stream.diagnostics.some((d) => d.code === "NON_CONTIGUOUS_LEVEL")).toBe(true);
  });

  it("accepts a forced version to skip detection", () => {
    const stream = streamGedcomRecords(MINIMAL_7, { version: "7.0.18" });
    expect(stream.version).toBe("7.0.18");
    expect([...stream]).toHaveLength(3);
  });

  it("throws when the version cannot be detected and none is supplied", () => {
    const input = `0 HEAD
1 SOUR Demo
0 TRLR`;
    expect(() => streamGedcomRecords(input)).toThrow();
  });

  it("directs callers to convert legacy 5.5.1 input to GEDCOM 7 first", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 TRLR`;
    expect(() => streamGedcomRecords(input)).toThrow(/7/);
  });

  it("requires the document to begin with HEAD", () => {
    const input = `0 @I1@ INDI
1 NAME Ada /Lovelace/
0 TRLR`;
    expect(() => streamGedcomRecords(input, { version: "7.0.18" })).toThrow();
  });

  it("throws when the document does not end with TRLR", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 NAME Ada /Lovelace/`;
    const stream = streamGedcomRecords(input, { version: "7.0.18" });
    expect(() => [...stream]).toThrow(/TRLR/);
  });

  it("throws when content follows TRLR", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 TRLR
0 @I1@ INDI`;
    const stream = streamGedcomRecords(input, { version: "7.0.18" });
    expect(() => [...stream]).toThrow(/TRLR/);
  });

  it("is lazy: a malformed line past the header is not reached until iteration advances to it", () => {
    // Line 7 is invalid GEDCOM 7 (a bare tag with no level). A pre-building
    // implementation would throw on construction; a lazy one only throws once
    // the iterator advances past the first valid record.
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 NAME Ada /Lovelace/
0 @I2@ INDI
this line is malformed
0 TRLR`;

    const stream = streamGedcomRecords(input, { version: "7.0.18" });
    const iterator = stream[Symbol.iterator]();

    // Header and the first record are reachable without touching line 7.
    expect(stream.header.raw.tag).toBe("HEAD");
    expect(iterator.next().value.xref).toBe("@I1@");

    // Advancing into the second record consumes line 7 and throws.
    expect(() => iterator.next()).toThrow();
  });

  it("streams the official maximal GEDCOM 7 sample identically to parseGedcom", () => {
    const input = readFixture("official/gedcom70/maximal70.ged");
    const batch = parseGedcom(input, { version: "7.0.18" });
    const streamedTags = [...streamGedcomRecords(input, { version: "7.0.18" })].map((r) => r.tag);

    const batchTags = [
      ...batch.records.map((r) => r.tag),
      ...batch.extensions.map((r) => r.tag)
    ];

    // Same multiset of top-level record tags (stream preserves document order;
    // parseGedcom segregates extensions, so compare as sorted multisets).
    expect(streamedTags.slice().sort()).toEqual(batchTags.slice().sort());
  });
});
