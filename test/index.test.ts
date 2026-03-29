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

  it("detects legacy GEDCOM 5.5", () => {
    expect(detectGedcomVersion(readFixture("official/gedcom551/TGC551.ged"))).toBe("5.5");
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

  it("parses official legacy GEDCOM 5.5 torture files with CR and LF line endings", () => {
    const crDocument = parseGedcom(readFixture("official/gedcom551/TGC551.ged"));
    const lfDocument = parseGedcom(readFixture("official/gedcom551/TGC551LF.ged"));

    expect(crDocument.version).toBe("5.5");
    expect(lfDocument.version).toBe("5.5");
    expect(crDocument.records.length).toBeGreaterThan(0);
    expect(lfDocument.records.length).toBeGreaterThan(0);
    expect(crDocument.header.characterSet).toBe("ANSEL");
    expect(lfDocument.header.characterSet).toBe("ANSEL");
  });

  it("combines CONT and CONC lines in GEDCOM 5.5.1 notes", () => {
    const input = `0 HEAD
1 SOUR KleioBase
2 VERS 0.1.0
2 NAME KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 SUBM @SUBM1@
1 CHAR UTF-8
0 @N1@ NOTE First line
1 CONT Second line
1 CONC continues
0 @SUBM1@ SUBM
1 NAME KleioBase
0 TRLR`;

    const document = parseGedcom(input, { version: "5.5.1" });

    expect(document.records[0]?.value).toBe("First line\nSecond linecontinues");
  });

  it("combines CONT lines in GEDCOM 7 notes", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @N1@ SNOTE First line
1 CONT Second line
0 TRLR`;

    const document = parseGedcom(input, { version: "7.0.18" });

    expect(document.records[0]?.value).toBe("First line\nSecond line");
  });

  it("decodes escaped leading at-signs in GEDCOM 7 payload lines", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @U1@ SUBM
1 NOTE me@example.com
2 CONT @@me is a handle
0 TRLR`;

    const document = parseGedcom(input, { version: "7.0.18" });

    expect(document.records[0]?.children[0]?.value).toBe("me@example.com\n@me is a handle");
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

  it("serializes multiline values using continuation lines", () => {
    const document = parseGedcom(`0 HEAD
1 GEDC
2 VERS 7.0.18
0 @N1@ SNOTE First line
1 CONT Second line
0 TRLR`, { version: "7.0.18" });

    const output = stringifyGedcom(document, { version: "7.0.18" });

    expect(output).toContain("0 @N1@ SNOTE First line");
    expect(output).toContain("1 CONT Second line");
  });

  it("escapes leading at-signs in GEDCOM 5.5.1 continuation lines", () => {
    const output = stringifyGedcom(
      {
        version: "5.5.1",
        header: {
          gedcomVersion: "5.5.1",
          characterSet: "UTF-8",
          sourceSystem: "KleioBase",
          raw: {
            level: 0,
            tag: "HEAD",
            children: []
          }
        },
        records: [
          {
            tag: "NOTE",
            value: "First line\n@handle",
            children: []
          }
        ],
        extensions: [],
        diagnostics: []
      },
      { version: "5.5.1" }
    );

    expect(output).toContain("1 CONT @@handle");
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

  it("converts GEDCOM 7 date phrases conservatively for GEDCOM 5.5.1", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 BIRT
2 DATE 30 JAN 1649
3 PHRASE 30 January 1648/49
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("2 DATE INT 30 JAN 1649 (30 January 1648/49)");
  });

  it("warns when a GEDCOM 7 date phrase cannot be expressed inline in GEDCOM 5.5.1", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 BIRT
2 DATE BET 1903 AND 1904
3 PHRASE 1903/4
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("2 DATE BET 1903 AND 1904");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "DATE_PHRASE_DEGRADED")).toBe(true);
  });

  it("converts GEDCOM 7 calendar keywords and BCE dates to GEDCOM 5.5.1 date syntax", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 EVEN
2 TYPE Ancient event
2 DATE FROM JULIAN 667 BCE TO GREGORIAN 324
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("2 DATE FROM @#DJULIAN@ 667 B.C. TO @#DGREGORIAN@ 324");
  });

  it("maps GEDCOM 7 multimedia FILE metadata to GEDCOM 5.5.1 FORM/TYPE", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @O1@ OBJE
1 FILE media/photo.jpg
2 FORM image/jpeg
3 MEDI PHOTO
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("0 @O1@ OBJE");
    expect(result.output).toContain("1 FILE media/photo.jpg");
    expect(result.output).toContain("2 FORM jpg");
    expect(result.output).toContain("3 TYPE PHOTO");
  });

  it("demotes incompatible GEDCOM 7 structures instead of emitting invalid GEDCOM 5.5.1 tags", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @F1@ FAM
1 ASSO @VOID@
2 ROLE OFFICIATOR
1 FACT Fact
1 UID 123
1 NO DIV
0 @I1@ INDI
1 RESI Residence
1 SEX X
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 EVEN Fact");
    expect(result.output).toContain("1 _UID 123");
    expect(result.output).toContain("1 _NO DIV");
    expect(result.output).toContain("1 SEX U");
    expect(result.output).not.toContain("1 ASSO @VOID@");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "DROPPED_MISSING_POINTER")).toBe(true);
  });

  it("keeps generic source citation EVEN payloads but clears generic individual EVEN payloads", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 EVEN Event
2 TYPE Event type
0 @S1@ SOUR
1 DATA
2 EVEN BIRT
3 DATE 1 JAN 1900
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("0 @I1@ INDI");
    expect(result.output).toContain("1 EVEN");
    expect(result.output).toContain("2 TYPE Event");
    expect(result.output).toContain("0 @S1@ SOUR");
    expect(result.output).toContain("2 EVEN BIRT");
  });

  it("keeps citation-level EVEN payloads under linked source references", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @O1@ OBJE
1 SOUR @S1@
2 EVEN BIRT
3 PHRASE Event phrase
0 @S1@ SOUR
1 TITL Source
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 SOUR @S1@");
    expect(result.output).toContain("2 EVEN BIRT");
    expect(result.output).not.toContain("2 EVEN\n3 TYPE BIRT");
  });

  it("moves family-level generic EVEN labels into the GEDCOM 5.5.1 descriptor slot", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @F1@ FAM
1 EVEN Event
2 TYPE Event type
1 FACT Fact
2 TYPE Fact type
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 EVEN Event");
    expect(result.output).toContain("2 TYPE Event type");
    expect(result.output).toContain("1 EVEN Fact");
    expect(result.output).toContain("2 TYPE Fact type");
  });

  it("demotes inline notes whose continuation text starts with @ to avoid invalid GEDCOM 5.5.1 note payloads", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 NOTE First line
2 CONT @@handle
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 _NOTE First line");
    expect(result.output).toContain("2 CONT @@handle");
  });

  it("parses and converts selected official GEDCOM 7 test files", () => {
    const officialFiles = [
      "official/gedcom70/notes-1.ged",
      "official/gedcom70/maximal70-memories2.ged",
      "official/gedcom70/maximal70.ged",
      "official/gedcom70/age.ged",
      "official/gedcom70/filename-1.ged"
    ];

    for (const file of officialFiles) {
      const input = readFixture(file);
      expect(() => parseGedcom(input, { version: "7.0.18" })).not.toThrow();
      expect(() =>
        convertGedcom(input, {
          from: "7.0.18",
          to: "5.5.1"
        })
      ).not.toThrow();
    }
  });

  it("converts official note and multimedia fixtures with only expected degradation diagnostics", () => {
    const notes = convertGedcom(readFixture("official/gedcom70/notes-1.ged"), {
      from: "7.0.18",
      to: "5.5.1"
    });
    const memories = convertGedcom(readFixture("official/gedcom70/maximal70-memories2.ged"), {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(notes.diagnostics).toHaveLength(0);
    expect(memories.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "DROPPED_MISSING_POINTER",
      "DROPPED_MISSING_POINTER",
      "FILE_REFERENCE_DEGRADED"
    ]);
  });

  it("reduces filename fixture diagnostics to the unsupported media and file-length edge cases we still expect", () => {
    const result = convertGedcom(readFixture("official/gedcom70/filename-1.ged"), {
      from: "7.0.18",
      to: "5.5.1"
    });

    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toEqual([
      "UNSUPPORTED_MEDIA_FORMAT",
      "FILE_REFERENCE_DEGRADED",
      "FILE_REFERENCE_DEGRADED",
      "FILE_REFERENCE_DEGRADED",
      "FILE_REFERENCE_DEGRADED",
      "FILE_REFERENCE_DEGRADED"
    ]);
  });

  it("can normalize a legacy GEDCOM 5.5 file into GEDCOM 5.5.1 output", () => {
    const result = convertGedcom(readFixture("official/gedcom551/TGC551LF.ged"), {
      from: "5.5",
      to: "5.5.1"
    });

    expect(result.version).toBe("5.5.1");
    expect(result.output).toContain("2 VERS 5.5.1");
    expect(result.output).toContain("2 FORM LINEAGE-LINKED");
  });

  it("sanitizes maximal70 output away from the loudest 7-only constructs", () => {
    const result = convertGedcom(readFixture("official/gedcom70/maximal70.ged"), {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).not.toMatch(/\n\d+ UID\b/);
    expect(result.output).not.toMatch(/\n\d+ CREA\b/);
    expect(result.output).not.toMatch(/\n\d+ TRAN\b/);
    expect(result.output).not.toMatch(/\n\d+ PHRASE\b/);
    expect(result.output).not.toContain("@VOID@");
    expect(result.output).not.toContain(" FORM jpeg");
    expect(result.output).not.toContain(" TYPE other");
  });
});
