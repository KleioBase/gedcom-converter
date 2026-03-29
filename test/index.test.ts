import { describe, expect, it } from "vitest";
import { convertGedcom, detectGedcomVersion, parseGedcom, stringifyGedcom } from "../src/index.js";
import { readFixture } from "./helpers.js";

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

describe("detectGedcomVersion", () => {
  it("detects GEDCOM 7.0.18", () => {
    expect(detectGedcomVersion(readFixture("minimal-7.0.18.ged"))).toBe("7.0.18");
  });

  it("detects GEDCOM 5.5.1", () => {
    expect(detectGedcomVersion(readFixture("minimal-5.5.1.ged"))).toBe("5.5.1");
  });

  it("detects GEDCOM versions with CRLF line endings", () => {
    const input = "0 HEAD\r\n1 GEDC\r\n2 VERS 7.0.18\r\n0 TRLR\r\n";
    expect(detectGedcomVersion(input)).toBe("7.0.18");
  });
});

describe("parseGedcom", () => {
  it("parses a minimal GEDCOM 7 file", () => {
    const document = parseGedcom(readFixture("minimal-7.0.18.ged"));

    expect(document.version).toBe("7.0.18");
    expect(document.records).toHaveLength(1);
    expect(document.records[0]?.tag).toBe("INDI");
  });

  it("parses a minimal GEDCOM 5.5.1 file", () => {
    const document = parseGedcom(readFixture("minimal-5.5.1.ged"));

    expect(document.version).toBe("5.5.1");
    expect(document.records).toHaveLength(2);
    expect(document.records.map((record) => record.tag)).toEqual(["INDI", "SUBM"]);
    expect(document.header.characterSet).toBe("UTF-8");
  });
});

describe("stringifyGedcom", () => {
  it("serializes a parsed GEDCOM 7 document", () => {
    const document = parseGedcom(readFixture("minimal-7.0.18.ged"));
    const output = stringifyGedcom(document, { version: "7.0.18" });

    expect(output).toContain("0 HEAD");
    expect(output).toContain("2 VERS 7.0.18");
    expect(output).not.toContain("\n1 CHAR ");
    expect(output).toContain("0 TRLR");
  });

  it("serializes a parsed GEDCOM 5.5.1 document", () => {
    const document = parseGedcom(readFixture("minimal-5.5.1.ged"));
    const output = stringifyGedcom(document, { version: "5.5.1" });

    expect(output).toContain("2 VERS 5.5.1");
    expect(output).toContain("2 FORM LINEAGE-LINKED");
    expect(output).toContain("1 SUBM @SUBM1@");
    expect(output).toContain("0 @SUBM1@ SUBM");
    expect(output).toContain("0 TRLR");
  });
});

describe("convertGedcom", () => {
  it("converts GEDCOM 7 shared notes and associations to GEDCOM 5.5.1 forms", () => {
    const result = convertGedcom(readFixture("conversion-7-to-551.ged"), {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(normalizeLineEndings(result.output)).toBe(
      normalizeLineEndings(readFixture("conversion-7-to-551.expected.ged"))
    );
  });

  it("preserves extension tags in parsed output", () => {
    const document = parseGedcom(readFixture("conversion-7-to-551.ged"), {
      version: "7.0.18"
    });

    const custom = document.records[0]?.children.find((child) => child.tag === "_KLEIO");
    expect(custom?.value).toBe("custom");
  });

  it("reports unsupported EXID mappings as warnings", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 EXID 999
2 TYPE https://example.com/exid/custom
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "UNSUPPORTED_EXID")).toBe(true);
    expect(result.output).toContain("1 _EXID 999");
  });
});
