import { describe, expect, it } from "vitest";
import { parseGedcom, stringifyGedcom } from "../src/index.js";
import type { ParsedDocument } from "../src/types.js";

function docWithNote(version: "7.0.18" | "5.5.1", noteValue: string): ParsedDocument {
  return {
    version,
    header: {
      gedcomVersion: version,
      characterSet: "UTF-8",
      raw: {
        level: 0,
        tag: "HEAD",
        children: [
          { level: 1, tag: "GEDC", children: [{ level: 2, tag: "VERS", value: version, children: [] }] }
        ]
      }
    },
    records: [
      {
        tag: "INDI",
        xref: "@I1@",
        children: [{ level: 1, tag: "NOTE", value: noteValue, children: [] }]
      }
    ],
    extensions: [],
    diagnostics: []
  };
}

function roundTripNote(version: "7.0.18" | "5.5.1", noteValue: string): string | undefined {
  const text = stringifyGedcom(docWithNote(version, noteValue), { version });
  const reparsed = parseGedcom(text, { version });
  return reparsed.records[0]?.children[0]?.value;
}

describe("leading-@ escaping (@@) round-trip", () => {
  // Spec §1.2: a line value whose first character is @ is escaped by doubling
  // it (@@) on write, and the leading @@ is halved back to @ on read. This must
  // hold for both the first line of a value and any CONT continuation line.

  it("preserves a single-line value that starts with @ (7.0.18)", () => {
    expect(roundTripNote("7.0.18", "@solo")).toBe("@solo");
  });

  it("preserves a single-line value that starts with @ (5.5.1)", () => {
    expect(roundTripNote("5.5.1", "@solo")).toBe("@solo");
  });

  it("preserves a continuation line that starts with @ (7.0.18)", () => {
    expect(roundTripNote("7.0.18", "line one\n@home address")).toBe("line one\n@home address");
  });

  it("preserves a continuation line that starts with @ (5.5.1)", () => {
    expect(roundTripNote("5.5.1", "line one\n@home address")).toBe("line one\n@home address");
  });

  it("emits a conformant doubled @ on the first line for 5.5.1", () => {
    const text = stringifyGedcom(docWithNote("5.5.1", "@solo"), { version: "5.5.1" });
    expect(text).toContain("1 NOTE @@solo");
    expect(text).not.toContain("1 NOTE @solo\n");
  });
});

describe("GEDCOM 7 line strictness", () => {
  const head = "0 HEAD\n1 GEDC\n2 VERS 7.0.18\n";

  it("rejects @VOID@ in the cross-reference-identifier slot (spec §1.3)", () => {
    // The Xref grammar explicitly excludes @VOID@; it is only valid as a payload.
    const input = `${head}0 @VOID@ INDI\n0 TRLR`;
    expect(() => parseGedcom(input, { version: "7.0.18" })).toThrow();
  });

  it("still accepts @VOID@ as a payload value (voidptr)", () => {
    const input = `${head}0 @I1@ INDI\n1 FAMC @VOID@\n0 TRLR`;
    expect(() => parseGedcom(input, { version: "7.0.18" })).not.toThrow();
  });

  it("rejects CONC, which is reserved and does not appear in 7.0 (spec §1.3)", () => {
    const input = `${head}0 @I1@ INDI\n1 NOTE start\n2 CONC more\n0 TRLR`;
    expect(() => parseGedcom(input, { version: "7.0.18" })).toThrow();
  });
});
