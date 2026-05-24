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

  it("reuses an existing submitter record instead of creating a synthetic one", () => {
    const output = stringifyGedcom(
      parseGedcom(readFixture("official/gedcom70/maximal70.ged"), { version: "7.0.18" }),
      { version: "5.5.1" }
    );

    expect(output).toContain("1 SUBM @U1@");
    expect(output).toContain("0 @U1@ SUBM");
    expect(output).not.toContain("0 @SUBM1@ SUBM");
  });

  it("preserves supported HEAD metadata and notes when stringifying GEDCOM 5.5.1", () => {
    const output = stringifyGedcom(
      parseGedcom(readFixture("official/gedcom70/maximal70.ged"), { version: "7.0.18" }),
      { version: "5.5.1" }
    );

    expect(output).toContain("1 SOUR https://gedcom.io/");
    expect(output).toContain("2 VERS 0.4");
    expect(output).toContain("2 NAME GEDCOM Steering Committee");
    expect(output).toContain("2 CORP FamilySearch");
    expect(output).toContain("2 DATA HEAD-SOUR-DATA");
    expect(output).toContain("3 DATE 1 NOV 2022");
    expect(output).toContain("1 DEST https://gedcom.io/");
    expect(output).toContain("1 DATE 10 JUN 2022");
    expect(output).toContain("2 TIME 15:43:20.48");
    expect(output).toContain("1 COPR another copyright statement");
    expect(output).toContain("1 NOTE This file is intended to provide coverage");
    expect(output).toContain("[Translation] Diese Datei soll Teile der Spezifikation abdecken");
    expect(output).toContain("Transmission time zone: Z");
    expect(output).toContain("Schema tag: _SKYPEID http://xmlns.com/foaf/0.1/skypeID");
  });

  it("normalizes unsupported header time zone suffixes into legal GEDCOM 5.5.1 TIME values", () => {
    const output = stringifyGedcom(
      parseGedcom(readFixture("official/gedcom70/maximal70.ged"), { version: "7.0.18" }),
      { version: "5.5.1" }
    );

    expect(output).toContain("1 DATE 10 JUN 2022");
    expect(output).toContain("2 TIME 15:43:20.48");
    expect(output).not.toContain("2 TIME 15:43:20.48Z");
    expect(output).toContain("Transmission time zone: Z");
  });

  it("preserves HEAD.PLAC.FORM when stringifying GEDCOM 5.5.1", () => {
    const document = parseGedcom(`0 HEAD
1 SOUR KleioBase
2 VERS 0.1.0
2 NAME KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 SUBM @SUBM1@
1 CHAR UTF-8
1 PLAC
2 FORM City, County, State, Country
0 @SUBM1@ SUBM
1 NAME KleioBase
0 TRLR`, { version: "5.5.1" });

    const output = stringifyGedcom(document, { version: "5.5.1" });

    expect(output).toContain("1 PLAC");
    expect(output).toContain("2 FORM City, County, State, Country");
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
  it("converts a minimal GEDCOM 5.5.1 document to GEDCOM 7", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 DEST KleioBase Test
1 DATE 19 MAY 2026
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 SUBM @SUBM1@
1 FILE sample.ged
1 COPR Copyright
1 CHAR UTF-8
1 NOTE Header note
1 PLAC
2 FORM City, Country
0 @I1@ INDI
1 NAME John /Doe/
1 _KLEIO custom
0 @SUBM1@ SUBM
1 NAME Submitter
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.version).toBe("7.0.18");
    expect(result.output).toContain("2 VERS 7.0.18");
    expect(result.output).toContain("1 SOUR KleioBase");
    expect(result.output).toContain("1 DEST KleioBase Test");
    expect(result.output).toContain("1 DATE 19 MAY 2026");
    expect(result.output).toContain("1 SUBM @SUBM1@");
    expect(result.output).toContain("1 FILE sample.ged");
    expect(result.output).toContain("1 COPR Copyright");
    expect(result.output).toContain("1 NOTE Header note");
    expect(result.output).toContain("1 PLAC");
    expect(result.output).toContain("2 FORM City, Country");
    expect(result.output).toContain("1 SCHMA");
    expect(result.output).toContain("2 TAG _KLEIO");
    expect(result.output).toContain("0 @I1@ INDI");
    expect(result.output).toContain("1 NAME John /Doe/");
    expect(result.output).toContain("1 _KLEIO custom");
    expect(result.output).not.toContain("1 CHAR UTF-8");
    expect(result.output).not.toContain("2 FORM LINEAGE-LINKED");
  });

  it("maps GEDCOM 5.5.1 personal name structures to GEDCOM 7", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Dr. John /Doe/ Jr.
2 NPFX Dr.
2 GIVN John
2 SURN Doe
2 NSFX Jr.
2 TYPE Maiden
1 NAME Johnny /Doe/
2 NICK Johnny
2 TYPE nickname at school
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("1 NAME Dr. John /Doe/ Jr.");
    expect(result.output).toContain("2 NPFX Dr.");
    expect(result.output).toContain("2 GIVN John");
    expect(result.output).toContain("2 SURN Doe");
    expect(result.output).toContain("2 NSFX Jr.");
    expect(result.output).toContain("2 TYPE MAIDEN");
    expect(result.output).toContain("1 NAME Johnny /Doe/");
    expect(result.output).toContain("2 NICK Johnny");
    expect(result.output).toContain("2 TYPE OTHER");
    expect(result.output).toContain("3 PHRASE nickname at school");
  });

  it("round-trips GEDCOM 5.5.1 personal name type text through GEDCOM 7", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Jane /Example/
2 GIVN Jane
2 SURN Example
2 TYPE maiden
1 NAME J /Example/
2 TYPE nickname at school
0 TRLR`;

    const upgraded = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });
    const roundTripped = convertGedcom(upgraded.output, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(roundTripped.output).toContain("1 NAME Jane /Example/");
    expect(roundTripped.output).toContain("2 GIVN Jane");
    expect(roundTripped.output).toContain("2 SURN Example");
    expect(roundTripped.output).toContain("2 TYPE maiden");
    expect(roundTripped.output).toContain("1 NAME J /Example/");
    expect(roundTripped.output).toContain("2 TYPE nickname at school");
  });

  it("maps a GEDCOM 5.5.1 individual event with full substructure to GEDCOM 7", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 BIRT
2 DATE 12 MAR 1880
2 PLAC Boston, Suffolk, Massachusetts, USA
3 FORM City, County, State, Country
2 ADDR 12 Main St
3 CITY Boston
3 STAE MA
3 POST 02108
3 CTRY USA
2 AGE 0y
2 CAUS Natural
2 AGNC County clerk
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.version).toBe("7.0.18");
    expect(result.output).toContain("1 BIRT");
    expect(result.output).toContain("2 DATE 12 MAR 1880");
    expect(result.output).toContain("2 PLAC Boston, Suffolk, Massachusetts, USA");
    expect(result.output).toContain("3 FORM City, County, State, Country");
    expect(result.output).toContain("2 ADDR 12 Main St");
    expect(result.output).toContain("3 CITY Boston");
    expect(result.output).toContain("3 STAE MA");
    expect(result.output).toContain("3 POST 02108");
    expect(result.output).toContain("3 CTRY USA");
    expect(result.output).toContain("2 AGE 0y");
    expect(result.output).toContain("2 CAUS Natural");
    expect(result.output).toContain("2 AGNC County clerk");
  });

  it("maps a GEDCOM 5.5.1 family event with custom EVEN TYPE to GEDCOM 7", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @F1@ FAM
1 EVEN
2 TYPE Civil union
2 DATE 14 FEB 2001
2 PLAC Reykjavik, Iceland
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("1 EVEN");
    expect(result.output).toContain("2 TYPE Civil union");
    expect(result.output).toContain("2 DATE 14 FEB 2001");
    expect(result.output).toContain("2 PLAC Reykjavik, Iceland");
  });

  it("maps a GEDCOM 5.5.1 individual attribute with payload to GEDCOM 7", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 OCCU Farmer
2 DATE FROM 1900 TO 1940
2 PLAC Rural County, State
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("1 OCCU Farmer");
    expect(result.output).toContain("2 DATE FROM 1900 TO 1940");
    expect(result.output).toContain("2 PLAC Rural County, State");
  });

  it("moves a non-numeric GEDCOM 5.5.1 AGE keyword into a GEDCOM 7 PHRASE", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 DEAT
2 DATE 1 JAN 1900
2 AGE STILLBORN
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("2 AGE");
    expect(result.output).toContain("3 PHRASE STILLBORN");
    expect(result.output).not.toContain("2 AGE STILLBORN");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "AGE_PHRASE_FALLBACK")).toBe(true);
  });

  it("preserves a numeric GEDCOM 5.5.1 AGE payload in GEDCOM 7 form", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 BIRT
2 AGE 23y 4m
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("2 AGE 23y 4m");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "AGE_PHRASE_FALLBACK")).toBe(false);
  });

  it("maps a GEDCOM 5.5.1 LDS baptism with STAT to GEDCOM 7", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 BAPL
2 DATE 14 JUN 1985
2 TEMP SLAKE
2 PLAC Salt Lake City, Utah
2 STAT PRE-1970
3 DATE 2 FEB 1972
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("1 BAPL");
    expect(result.output).toContain("2 DATE 14 JUN 1985");
    expect(result.output).toContain("2 TEMP SLAKE");
    expect(result.output).toContain("2 PLAC Salt Lake City, Utah");
    expect(result.output).toContain("2 STAT PRE_1970");
    expect(result.output).toContain("3 DATE 2 FEB 1972");
  });

  it("maps a GEDCOM 5.5.1 SLGS spouse sealing inside a FAM record", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @F1@ FAM
1 SLGS
2 DATE 3 MAR 1990
2 TEMP SLAKE
2 PLAC Salt Lake City, Utah
2 STAT COMPLETED
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("0 @F1@ FAM");
    expect(result.output).toContain("1 SLGS");
    expect(result.output).toContain("2 STAT COMPLETED");
  });

  it("preserves an unmappable LDS STAT value as a PHRASE", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 BAPL
2 STAT EXPERIMENTAL
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("2 STAT");
    expect(result.output).toContain("3 PHRASE EXPERIMENTAL");
    expect(result.output).not.toContain("2 STAT EXPERIMENTAL");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "LDS_STAT_UNMAPPED")).toBe(true);
  });

  it("normalizes a GEDCOM 5.5.1 RESN value into GEDCOM 7 enum form", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Confidential /Person/
1 RESN privacy
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("1 RESN PRIVACY");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "RESN_NORMALIZED")).toBe(true);
  });

  it("preserves an unmappable GEDCOM 5.5.1 RESN value as _RESN extension", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 RESN do-not-share
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("1 _RESN do-not-share");
    expect(result.output).toContain("2 TAG _RESN");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "RESN_PHRASE_FALLBACK")).toBe(true);
  });

  it("maps GEDCOM 5.5.1 STAT DNS/CAN to GEDCOM 7 DNS_CAN", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @F1@ FAM
1 SLGS
2 DATE 3 MAR 1990
2 TEMP SLAKE
2 STAT DNS/CAN
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("2 STAT DNS_CAN");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "LDS_STAT_UNMAPPED")).toBe(false);
  });

  it("normalizes GEDCOM 5.5.1 AGE payload spacing for GEDCOM 7", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 BIRT
2 AGE <5y
1 DEAT
2 AGE >8d
1 BURI
2 AGE 5y4m
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("2 AGE < 5y");
    expect(result.output).toContain("2 AGE > 8d");
    expect(result.output).toContain("2 AGE 5y 4m");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "AGE_PHRASE_FALLBACK")).toBe(false);
  });

  it("treats a bare GEDCOM 5.5.1 AGE bound as a PHRASE fallback", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 BIRT
2 AGE <
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("2 AGE");
    expect(result.output).toContain("3 PHRASE <");
    expect(result.output).not.toContain("2 AGE <");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "AGE_PHRASE_FALLBACK")).toBe(true);
  });

  it("synthesizes GEDCOM 7 IDNO TYPE OTHER when 5.5.1 omits TYPE", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 IDNO 123-45-6789
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("1 IDNO 123-45-6789");
    expect(result.output).toContain("2 TYPE OTHER");
    expect(result.output).toContain("3 PHRASE 123-45-6789");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "IDNO_TYPE_SYNTHESIZED")).toBe(true);
  });

  it("preserves an explicit GEDCOM 5.5.1 IDNO TYPE without synthesizing OTHER", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 IDNO A1234567
2 TYPE Passport
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("1 IDNO A1234567");
    expect(result.output).toContain("2 TYPE Passport");
    expect(result.output).not.toContain("2 TYPE OTHER");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "IDNO_TYPE_SYNTHESIZED")).toBe(false);
  });

  it("round-trips a GEDCOM 5.5.1 MARR family event through GEDCOM 7 and back", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @F1@ FAM
1 MARR
2 DATE 4 JUL 1900
2 PLAC Springfield, Illinois, USA
0 TRLR`;

    const upgraded = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });
    const roundTripped = convertGedcom(upgraded.output, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(roundTripped.output).toContain("0 @F1@ FAM");
    expect(roundTripped.output).toContain("1 MARR");
    expect(roundTripped.output).toContain("2 DATE 4 JUL 1900");
    expect(roundTripped.output).toContain("2 PLAC Springfield, Illinois, USA");
  });

  it("round-trips a GEDCOM 5.5.1 RESN value through GEDCOM 7 and back", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Private /Person/
1 RESN privacy
0 TRLR`;

    const upgraded = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });
    const roundTripped = convertGedcom(upgraded.output, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(roundTripped.output).toContain("1 RESN PRIVACY");
  });

  it("round-trips a GEDCOM 5.5.1 ENDL ordinance through GEDCOM 7 and back", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 ENDL
2 DATE 5 MAY 1980
2 TEMP SLAKE
2 PLAC Salt Lake City, Utah
2 STAT COMPLETED
0 TRLR`;

    const upgraded = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });
    const roundTripped = convertGedcom(upgraded.output, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(roundTripped.output).toContain("1 ENDL");
    expect(roundTripped.output).toContain("2 DATE 5 MAY 1980");
    expect(roundTripped.output).toContain("2 TEMP SLAKE");
    expect(roundTripped.output).toContain("2 PLAC Salt Lake City, Utah");
    expect(roundTripped.output).toContain("2 STAT COMPLETED");
  });

  it("round-trips a GEDCOM 5.5.1 IDNO with explicit TYPE through GEDCOM 7 and back", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 IDNO A1234567
2 TYPE Passport
0 TRLR`;

    const upgraded = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });
    const roundTripped = convertGedcom(upgraded.output, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(roundTripped.output).toContain("1 IDNO A1234567");
    expect(roundTripped.output).toContain("2 TYPE Passport");
  });

  it("round-trips a GEDCOM 5.5.1 BIRT event through GEDCOM 7 and back", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 BIRT
2 DATE 12 MAR 1880
2 PLAC Boston, Suffolk, Massachusetts, USA
2 AGE 0y
0 TRLR`;

    const upgraded = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });
    const roundTripped = convertGedcom(upgraded.output, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(roundTripped.output).toContain("1 BIRT");
    expect(roundTripped.output).toContain("2 DATE 12 MAR 1880");
    expect(roundTripped.output).toContain("2 PLAC Boston, Suffolk, Massachusetts, USA");
    expect(roundTripped.output).toContain("2 AGE 0y");
  });

  it("maps a GEDCOM 5.5.1 ASSO with an enum-matching RELA to a GEDCOM 7 ROLE", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Jane /Doe/
1 ASSO @I2@
2 RELA Father
0 @I2@ INDI
1 NAME John /Doe/
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("1 ASSO @I2@");
    expect(result.output).toContain("2 ROLE FATH");
    expect(result.output).not.toContain("2 RELA Father");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "RELA_PHRASE_FALLBACK")).toBe(false);
  });

  it("falls back to ROLE OTHER + PHRASE for a non-enum 5.5.1 ASSO RELA", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Jane /Doe/
1 ASSO @I2@
2 RELA Best friend
0 @I2@ INDI
1 NAME John /Doe/
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("1 ASSO @I2@");
    expect(result.output).toContain("2 ROLE OTHER");
    expect(result.output).toContain("3 PHRASE Best friend");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "RELA_PHRASE_FALLBACK")).toBe(true);
  });

  it("synthesizes GEDCOM 7 ASSO ROLE OTHER when 5.5.1 source omits RELA", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Jane /Doe/
1 ASSO @I2@
0 @I2@ INDI
1 NAME John /Doe/
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("1 ASSO @I2@");
    expect(result.output).toContain("2 ROLE OTHER");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "ASSO_ROLE_SYNTHESIZED")).toBe(true);
  });

  it("promotes a top-level GEDCOM 5.5.1 NOTE record to a GEDCOM 7 SNOTE record and rewrites inline pointers", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @N1@ NOTE Shared note text
0 @I1@ INDI
1 NAME Jane /Doe/
1 NOTE @N1@
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("0 @N1@ SNOTE Shared note text");
    expect(result.output).toContain("1 SNOTE @N1@");
    expect(result.output).not.toContain("0 @N1@ NOTE");
    expect(result.output).not.toContain("1 NOTE @N1@");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "NOTE_RECORD_PROMOTED")).toBe(true);
  });

  it("leaves inline 5.5.1 NOTE substructures with literal payload as GEDCOM 7 NOTE", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Jane /Doe/
1 NOTE Inline note text
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("1 NOTE Inline note text");
    expect(result.output).not.toContain("1 SNOTE Inline note text");
  });

  it("maps a GEDCOM 5.5.1 source-citation ROLE under SOUR.EVEN to a GEDCOM 7 ROLE enum", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 BIRT
2 SOUR @S1@
3 PAGE 12
3 EVEN BIRT
4 ROLE Father
0 @S1@ SOUR
1 TITL Parish register
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("3 EVEN BIRT");
    expect(result.output).toContain("4 ROLE FATH");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "CITATION_ROLE_PHRASE_FALLBACK")).toBe(false);
  });

  it("falls back to ROLE OTHER + PHRASE for a non-enum source-citation ROLE", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 BIRT
2 SOUR @S1@
3 EVEN BIRT
4 ROLE Family lawyer
0 @S1@ SOUR
1 TITL Parish register
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("4 ROLE OTHER");
    expect(result.output).toContain("5 PHRASE Family lawyer");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "CITATION_ROLE_PHRASE_FALLBACK")).toBe(true);
  });

  it("preserves a GEDCOM 5.5.1 SOUR record substructure into GEDCOM 7", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @S1@ SOUR
1 DATA
2 EVEN BIRT, DEAT
3 DATE FROM 1800 TO 1900
3 PLAC Boston, Massachusetts
2 AGNC County clerk
1 AUTH John Smith
1 TITL Vital Records of Boston
1 ABBR VR Boston
1 PUBL 1923, Boston Press
1 TEXT Source full text excerpt
1 REFN VR-1923
1 RIN 4242
1 REPO @R1@
2 CALN 929.3 Smi
3 MEDI book
0 @R1@ REPO
1 NAME Boston Archives
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("0 @S1@ SOUR");
    expect(result.output).toContain("1 DATA");
    expect(result.output).toContain("2 EVEN BIRT, DEAT");
    expect(result.output).toContain("3 DATE FROM 1800 TO 1900");
    expect(result.output).toContain("3 PLAC Boston, Massachusetts");
    expect(result.output).toContain("2 AGNC County clerk");
    expect(result.output).toContain("1 AUTH John Smith");
    expect(result.output).toContain("1 TITL Vital Records of Boston");
    expect(result.output).toContain("1 ABBR VR Boston");
    expect(result.output).toContain("1 PUBL 1923, Boston Press");
    expect(result.output).toContain("1 TEXT Source full text excerpt");
    expect(result.output).toContain("1 REFN VR-1923");
    expect(result.output).toContain("1 EXID 4242");
    expect(result.output).toContain("2 TYPE https://kleiobase.io/terms/legacy/551/RIN");
    expect(result.output).toContain("1 REPO @R1@");
    expect(result.output).toContain("2 CALN 929.3 Smi");
    expect(result.output).toContain("3 MEDI BOOK");
    expect(result.output).not.toContain("3 MEDI book");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "RIN_TO_EXID")).toBe(true);
  });

  it("preserves an inline GEDCOM 5.5.1 source citation with PAGE/EVEN/DATA/QUAY into GEDCOM 7", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 BIRT
2 SOUR @S1@
3 PAGE Vol. 2, p. 14
3 EVEN BIRT
4 DATE 12 MAR 1880
3 DATA
4 DATE 12 MAR 1880
4 TEXT Verbatim citation text
3 QUAY 3
0 @S1@ SOUR
1 TITL Parish register
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("2 SOUR @S1@");
    expect(result.output).toContain("3 PAGE Vol. 2, p. 14");
    expect(result.output).toContain("3 EVEN BIRT");
    expect(result.output).toContain("4 DATE 12 MAR 1880");
    expect(result.output).toContain("3 DATA");
    expect(result.output).toContain("4 TEXT Verbatim citation text");
    expect(result.output).toContain("3 QUAY 3");
  });

  it("preserves a GEDCOM 5.5.1 REPO record substructure into GEDCOM 7", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @R1@ REPO
1 NAME Boston Archives
1 ADDR 100 Archive Way
2 CITY Boston
2 STAE MA
2 POST 02101
2 CTRY USA
1 PHON +1-617-555-0100
1 EMAIL archives@example.org
1 WWW https://archives.example.org
1 REFN BA-001
1 RIN 7
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("0 @R1@ REPO");
    expect(result.output).toContain("1 NAME Boston Archives");
    expect(result.output).toContain("1 ADDR 100 Archive Way");
    expect(result.output).toContain("2 CITY Boston");
    expect(result.output).toContain("2 STAE MA");
    expect(result.output).toContain("2 POST 02101");
    expect(result.output).toContain("2 CTRY USA");
    expect(result.output).toContain("1 PHON +1-617-555-0100");
    expect(result.output).toContain("1 EMAIL archives@example.org");
    expect(result.output).toContain("1 WWW https://archives.example.org");
    expect(result.output).toContain("1 REFN BA-001");
    expect(result.output).toContain("1 EXID 7");
    expect(result.output).toContain("2 TYPE https://kleiobase.io/terms/legacy/551/RIN");
    expect(result.output).not.toContain("1 RIN 7");
  });

  it("preserves a GEDCOM 5.5.1 SUBM record substructure into GEDCOM 7", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 SUBM @SUBM1@
1 CHAR UTF-8
0 @SUBM1@ SUBM
1 NAME Andres Denkberg
1 ADDR 1 Main St
2 CITY Boston
2 CTRY USA
1 PHON +1-617-555-0101
1 EMAIL andres@example.org
1 WWW https://example.org
1 LANG English
1 RFN SUB-1
1 RIN 1
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });

    expect(result.output).toContain("0 @SUBM1@ SUBM");
    expect(result.output).toContain("1 NAME Andres Denkberg");
    expect(result.output).toContain("1 ADDR 1 Main St");
    expect(result.output).toContain("2 CITY Boston");
    expect(result.output).toContain("2 CTRY USA");
    expect(result.output).toContain("1 PHON +1-617-555-0101");
    expect(result.output).toContain("1 EMAIL andres@example.org");
    expect(result.output).toContain("1 WWW https://example.org");
    expect(result.output).toContain("1 LANG English");
    expect(result.output).toContain("1 EXID SUB-1");
    expect(result.output).toContain("2 TYPE https://kleiobase.io/terms/legacy/551/RFN#");
    expect(result.output).toContain("1 EXID 1");
    expect(result.output).toContain("2 TYPE https://kleiobase.io/terms/legacy/551/RIN");
    expect(result.output).not.toContain("1 RFN SUB-1");
    expect(result.output).not.toContain("1 RIN 1");
  });

  it("round-trips a GEDCOM 5.5.1 ASSO with non-enum RELA through GEDCOM 7 and back", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 NAME Jane /Doe/
1 ASSO @I2@
2 RELA Best friend
0 @I2@ INDI
1 NAME John /Doe/
0 TRLR`;

    const upgraded = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });
    const roundTripped = convertGedcom(upgraded.output, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(roundTripped.output).toContain("1 ASSO @I2@");
    expect(roundTripped.output).toContain("2 RELA Best friend");
  });

  it("round-trips a top-level GEDCOM 5.5.1 NOTE record + inline pointer through GEDCOM 7 and back", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @N1@ NOTE Shared note text
0 @I1@ INDI
1 NAME Jane /Doe/
1 NOTE @N1@
0 TRLR`;

    const upgraded = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });
    const roundTripped = convertGedcom(upgraded.output, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(roundTripped.output).toContain("0 @N1@ NOTE Shared note text");
    expect(roundTripped.output).toContain("1 NOTE @N1@");
  });

  it("round-trips a GEDCOM 5.5.1 source citation combining PAGE, QUAY, and ROLE through GEDCOM 7 and back", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 BIRT
2 SOUR @S1@
3 PAGE Vol. 2, p. 14
3 EVEN BIRT
4 ROLE Father
3 QUAY 3
0 @S1@ SOUR
1 TITL Parish register
0 TRLR`;

    const upgraded = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });
    const roundTripped = convertGedcom(upgraded.output, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(roundTripped.output).toContain("2 SOUR @S1@");
    expect(roundTripped.output).toContain("3 PAGE Vol. 2, p. 14");
    expect(roundTripped.output).toContain("3 EVEN BIRT");
    // ROLE round-trips value-preserving but case-asymmetric: 5.5.1 "Father" →
    // v7 "FATH" → 5.5.1 "FATH". The v7→5.5.1 mapRoleToSourceCitationRole
    // preserves the v7 enum verbatim by design.
    expect(roundTripped.output).toContain("4 ROLE FATH");
    expect(roundTripped.output).toContain("3 QUAY 3");
  });

  it("round-trips a GEDCOM 5.5.1 REPO citation with CALN/MEDI through GEDCOM 7 and back", () => {
    const input = `0 HEAD
1 SOUR KleioBase
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @S1@ SOUR
1 TITL Parish register
1 REPO @R1@
2 CALN 929.3 Smi
3 MEDI book
0 @R1@ REPO
1 NAME Boston Archives
0 TRLR`;

    const upgraded = convertGedcom(input, {
      from: "5.5.1",
      to: "7.0.18"
    });
    const roundTripped = convertGedcom(upgraded.output, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(roundTripped.output).toContain("1 REPO @R1@");
    expect(roundTripped.output).toContain("2 CALN 929.3 Smi");
    // MEDI round-trips value-preserving but case-asymmetric: 5.5.1 "book" →
    // v7 enum "BOOK" → 5.5.1 "BOOK". v7→5.5.1 preserves the v7 enum verbatim.
    expect(roundTripped.output).toContain("3 MEDI BOOK");
  });

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

    expect(result.output).toContain("1 REFN 999");
    expect(result.output).toContain("2 TYPE https://example.com/exid/custom");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "EXID_TO_REFN")).toBe(true);
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
    expect(result.output).toContain("1 REFN 123");
    expect(result.output).toContain("2 TYPE UUID");
    expect(result.output).toContain("1 NOTE No DIV");
    expect(result.output).toContain("1 NOTE Association: @VOID@");
    expect(result.output).toContain("1 SEX U");
    expect(result.output).not.toContain("1 ASSO @VOID@");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "VOID_POINTER_NOTED")).toBe(true);
  });

  it("rewrites NO structures as legal notes with date and citation context", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 NO DIV
2 DATE FROM 1700 TO 1800
2 NOTE Note text
2 SNOTE @N1@
2 SOUR @S1@
3 PAGE 42
0 @N1@ SNOTE Shared note
0 @S1@ SOUR
1 TITL Source
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 NOTE No DIV");
    expect(result.output).toContain("2 CONT Date: FROM 1700 TO 1800");
    expect(result.output).toContain("2 CONT Note: Note text");
    expect(result.output).toContain("2 CONT Related note: @N1@");
    expect(result.output).toContain("2 CONT [Source citation @S1@, Page 42]");
    expect(result.output).not.toContain("_NO DIV");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "NO_NOTED")).toBe(true);
  });

  it("rewrites unsupported associations and sort dates as notes", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @F1@ FAM
1 MARR
2 SDATE 27 MAR 2022
3 TIME 16:03
2 ASSO @I3@
3 RELA Role text
3 NOTE Note text
3 SOUR @S1@
4 PAGE 1
0 @I3@ INDI
1 NAME Example /Associate/
0 @S1@ SOUR
1 TITL Source
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("2 NOTE Sort date: 27 MAR 2022");
    expect(result.output).toContain("3 CONT Time: 16:03");
    expect(result.output).toContain("2 NOTE Association: @I3@");
    expect(result.output).toContain("3 CONT Role: Role text");
    expect(result.output).toContain("3 CONT Note: Note text");
    expect(result.output).toContain("3 CONT [Source citation @S1@, Page 1]");
    expect(result.output).not.toContain("_SDATE 27 MAR 2022");
    expect(result.output).not.toContain("_ASSO @I3@");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "SDATE_NOTED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "ASSOCIATION_NOTED")).toBe(true);
  });

  it("rewrites invalid STAT values as notes while preserving their dates", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 SLGS
2 STAT DNS_CAN
3 DATE 27 MAR 2022
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 SLGS");
    expect(result.output).toContain("2 NOTE Status: DNS_CAN");
    expect(result.output).toContain("3 CONT Date: 27 MAR 2022");
    expect(result.output).not.toContain("_STAT DNS_CAN");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "STAT_NOTED")).toBe(true);
  });

  it("rewrites unsupported identifiers and contact ids as notes when 5.5.1 cannot carry them directly", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @O1@ OBJE
1 _REFN 1
2 TYPE User-generated identifier
1 _EXID 123
2 TYPE http://example.com
1 SKYPEID example.person
1 JABBERID person@example.com
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 NOTE User reference number: 1");
    expect(result.output).toContain("[Type: User-generated identifier]");
    expect(result.output).toContain("1 REFN 123");
    expect(result.output).toContain("2 TYPE http://example.com");
    expect(result.output).toContain("1 NOTE Skype ID: example.person");
    expect(result.output).toContain("1 NOTE Jabber ID: person@example.com");
    expect(result.output).not.toContain("_REFN 1");
    expect(result.output).not.toContain("_EXID 123");
    expect(result.output).not.toContain("_SKYPEID example.person");
    expect(result.output).not.toContain("_JABBERID person@example.com");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "REFN_NOTED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "CONTACT_ID_NOTED")).toBe(true);
  });

  it("rewrites invalid SSN values and NCHI metadata as notes", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @F1@ FAM
1 NCHI 2
2 TYPE Type of children
2 HUSB
3 AGE 25y
2 WIFE
3 AGE 24y
0 @I1@ INDI
1 SSN ssn
2 TYPE ssn type
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 NCHI 2");
    expect(result.output).toContain("1 NOTE Number of children type: Type of children");
    expect(result.output).toContain("1 NOTE Husband child-bearing age: 25y");
    expect(result.output).toContain("1 NOTE Wife child-bearing age: 24y");
    expect(result.output).toContain("1 NOTE Social Security number: ssn");
    expect(result.output).toContain("[Type: ssn type]");
    expect(result.output).not.toContain("_TYPE Type of children");
    expect(result.output).not.toContain("_HUSB");
    expect(result.output).not.toContain("_WIFE");
    expect(result.output).not.toContain("_SSN ssn");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "NCHI_METADATA_NOTED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "SSN_NOTED")).toBe(true);
  });

  it("rewrites unsupported LDS INIL and missing-FAMC SLGC structures as notes", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 INIL
2 STAT EXCLUDED
3 DATE 27 MAR 2022
1 SLGC
2 DATE 27 MAR 2022
3 TIME 15:47
2 TEMP SLAKE
1 SLGC
2 PLAC Place
2 STAT BIC
3 DATE 27 MAR 2022
2 NOTE Note text
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 NOTE Initiatory");
    expect(result.output).toContain("2 CONT Status: EXCLUDED");
    expect(result.output).toContain("2 CONT Date: 27 MAR 2022");
    expect(result.output).toContain("1 NOTE Sealing to parents");
    expect(result.output).toContain("2 CONT Temple: SLAKE");
    expect(result.output).toContain("2 CONT Note: Time: 15:47");
    expect(result.output).toContain("2 CONT Place: Place");
    expect(result.output).toContain("2 CONT Status: BIC");
    expect(result.output).not.toContain("_INIL");
    expect(result.output).not.toContain("_SLGC");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "INIL_NOTED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "SLGC_NOTED")).toBe(true);
  });

  it("rewrites object-level RESN values as notes", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @O1@ OBJE
1 RESN PRIVACY
1 FILE media/photo.jpg
2 FORM image/jpeg
3 MEDI PHOTO
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("0 @O1@ OBJE");
    expect(result.output).toContain("1 NOTE Restriction: PRIVACY");
    expect(result.output).not.toContain("_RESN PRIVACY");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "OBJECT_RESN_NOTED")).toBe(true);
  });

  it("hoists husband, wife, and child phrases into parent notes", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @F1@ FAM
1 NO ANUL
1 HUSB @I1@
2 PHRASE Husband phrase
1 WIFE @I2@
2 PHRASE Wife phrase
1 CHIL @I3@
2 PHRASE First child
0 @I1@ INDI
1 NAME Husband /Example/
0 @I2@ INDI
1 NAME Wife /Example/
0 @I3@ INDI
1 NAME Child /Example/
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 NOTE Husband phrase: Husband phrase");
    expect(result.output).toContain("1 NOTE Wife phrase: Wife phrase");
    expect(result.output).toContain("1 NOTE Child phrase: First child");
    expect(result.output).not.toContain("_PHRASE Husband phrase");
    expect(result.output).not.toContain("_PHRASE Wife phrase");
    expect(result.output).not.toContain("_PHRASE First child");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "POINTER_PHRASE_NOTED")).toBe(true);
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
    expect(result.output).toContain("2 NOTE Citation event phrase: Event phrase");
    expect(result.output).not.toContain("_PHRASE Event phrase");
  });

  it("maps source-citation roles to GEDCOM 5.5.1 ROLE descriptors", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @O1@ OBJE
1 SOUR @S1@
2 EVEN BIRT
3 ROLE OTHER
4 PHRASE Midwife
0 @S1@ SOUR
1 TITL Source
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("2 EVEN BIRT");
    expect(result.output).toContain("3 ROLE (Midwife)");
    expect(result.output).not.toContain("_PHRASE Midwife");
    expect(result.output).not.toContain("_RELA Midwife");
  });

  it("humanizes preserved association role text when an ASSO must be rewritten as a note", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @F1@ FAM
1 MARR
2 ASSO @I3@
3 RELA CHIL
0 @I3@ INDI
1 NAME Child /Example/
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("2 NOTE Association: @I3@");
    expect(result.output).toContain("3 CONT Role: Child");
  });

  it("maps GEDCOM 7 name-type phrases into GEDCOM 5.5.1 NAME.TYPE text", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 NAME Mark /Twain/
2 TYPE PROFESSIONAL
3 PHRASE Pen
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 NAME Mark /Twain/");
    expect(result.output).toContain("2 TYPE Pen");
    expect(result.output).not.toContain("_PHRASE Pen");
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

  it("rewrites leftover _VALUE children as notes on event and residence structures", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 RESI Residence
2 TYPE Type of residence
1 FACT Fact
2 TYPE Type of fact
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 RESI");
    expect(result.output).toContain("2 TYPE Type of residence");
    expect(result.output).toContain("2 NOTE Residence value: Residence");
    expect(result.output).toContain("1 EVEN");
    expect(result.output).toContain("2 TYPE Type of fact");
    expect(result.output).toContain("2 NOTE Event value: Fact");
    expect(result.output).not.toContain("_VALUE Residence");
    expect(result.output).not.toContain("_VALUE Fact");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "VALUE_NOTED")).toBe(true);
  });

  it("drops redundant or sorting-only phrase fallbacks when GEDCOM 5.5.1 already carries the meaning", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @F1@ FAM
1 MARR
2 HUSB
3 AGE 25y
4 PHRASE Adult
2 SDATE 28 MAR 2022
3 PHRASE Afternoon
0 @I1@ INDI
1 ALIA @I2@
2 PHRASE Alias
0 @I2@ INDI
1 NAME Example /Person/
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("3 AGE 25y");
    expect(result.output).not.toContain("_PHRASE Adult");
    expect(result.output).not.toContain("_PHRASE Afternoon");
    expect(result.output).not.toContain("_PHRASE Alias");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "REDUNDANT_AGE_PHRASE_DROPPED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "SDATE_PHRASE_DROPPED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "REDUNDANT_ALIAS_PHRASE_DROPPED")).toBe(true);
  });

  it("keeps legal 5.5.1 change times and notes unsupported event times", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
1 LANG en-US
0 @I1@ INDI
1 BIRT
2 DATE 1 JAN 1900
3 TIME 12:34:56
1 CHAN
2 DATE 2 JAN 1900
3 TIME 07:08:09
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 LANG English");
    expect(result.output).toContain("1 BIRT");
    expect(result.output).toContain("2 NOTE Time: 12:34:56");
    expect(result.output).toContain("1 CHAN");
    expect(result.output).toContain("2 DATE 2 JAN 1900");
    expect(result.output).toContain("3 TIME 07:08:09");
    expect(result.output).not.toContain("_TIME 12:34:56");
    expect(result.output).not.toContain("_TIME 07:08:09");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "EVENT_TIME_NOTED")).toBe(true);
  });

  it("notes CREA and LDS times instead of leaving _TIME fallbacks behind", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 CREA
2 DATE 1 JAN 1900
3 TIME 01:02:03
1 SLGS
2 DATE 2 JAN 1900
3 TIME 04:05:06
2 STAT COMPLETED
3 DATE 2 JAN 1900
4 TIME 07:08:09
1 SLGC
2 DATE 3 JAN 1900
3 TIME 10:11:12
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 NOTE Creation date: 1 JAN 1900");
    expect(result.output).toContain("2 CONT Creation time: 01:02:03");
    expect(result.output).toContain("1 SLGS");
    expect(result.output).toContain("2 NOTE Time: 04:05:06");
    expect(result.output).toContain("2 NOTE Status time: 07:08:09");
    expect(result.output).toContain("1 NOTE Sealing to parents");
    expect(result.output).toContain("2 CONT Date: 3 JAN 1900");
    expect(result.output).toContain("2 CONT Note: Time: 10:11:12");
    expect(result.output).not.toContain("1 _CREA");
    expect(result.output).not.toContain("_TIME 01:02:03");
    expect(result.output).not.toContain("_TIME 04:05:06");
    expect(result.output).not.toContain("_TIME 07:08:09");
    expect(result.output).not.toContain("_TIME 10:11:12");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "CREA_NOTED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "CREA_TIME_NOTED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "LDS_DATE_TIME_NOTED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "LDS_STATUS_TIME_NOTED")).toBe(true);
  });

  it("inlines unsupported language tags into nearby 5.5.1 text instead of emitting _LANG", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @N1@ SNOTE Shared note
1 LANG en-US
1 TRAN Shared note in British English
2 LANG en-GB
0 @S1@ SOUR
1 DATA
2 TEXT Source text
3 LANG en-US
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("0 @N1@ NOTE Shared note\n1 CONT [Language: English]");
    expect(result.output).toContain("1 CONT [Translation] Shared note in British English");
    expect(result.output).toContain("2 TEXT Source text");
    expect(result.output).toContain("3 CONT [Language: English]");
    expect(result.output).not.toContain("_LANG English");
    expect(result.output).not.toContain("_TRAN Shared note in British English");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "TEXT_LANGUAGE_NOTED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "TRAN_LANGUAGE_INLINED")).toBe(true);
  });

  it("keeps PLAC.FORM standard and drops redundant plain-text FORM markers", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 BIRT
2 PLAC City, County, State
3 FORM City, County, State
1 NOTE Plain text note
2 MIME text/plain
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("2 PLAC City, County, State");
    expect(result.output).toContain("3 FORM City, County, State");
    expect(result.output).not.toContain("_FORM City, County, State");
    expect(result.output).not.toContain("_FORM txt");
  });

  it("rewrites NAME translations as standard notes", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 NAME Joseph /Doe/
2 TRAN Josef /Doe/
3 LANG de
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 NAME Joseph /Doe/");
    expect(result.output).toContain("2 NOTE Name translation: Josef /Doe/");
    expect(result.output).not.toContain("_TRAN Josef /Doe/");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "NAME_TRANSLATION_NOTED")).toBe(true);
  });

  it("drops redundant place translations that duplicate the main place text", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @S1@ SOUR
1 DATA
2 EVEN BIRT
3 PLAC Some City, Some County
4 FORM City, County
4 TRAN Some City, Some County
5 LANG en-GB
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("3 PLAC Some City, Some County");
    expect(result.output).not.toContain("_TRAN Some City, Some County");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "REDUNDANT_PLACE_TRANSLATION_DROPPED")).toBe(true);
  });

  it("hoists source-record place hierarchy into a legal DATA note", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @S1@ SOUR
1 DATA
2 EVEN BIRT
3 PLAC Some City, Some County, Some State
4 FORM City, County, State
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("3 PLAC Some City, Some County, Some State");
    expect(result.output).not.toContain("4 FORM City, County, State");
    expect(result.output).toContain("2 NOTE Place hierarchy: City, County, State");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "SOURCE_PLACE_HIERARCHY_NOTED")).toBe(true);
  });

  it("hoists unsupported source-record place metadata into legal DATA notes", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @S1@ SOUR
1 DATA
2 EVEN BIRT
3 PLAC Some City
4 LANG en-US
4 MAP
5 LATI N18.150944
5 LONG E168.150944
4 EXID 123
5 TYPE http://example.com
4 NOTE @N1@
4 SOUR @S1@
5 PAGE 1
0 @N1@ SNOTE Shared note
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("2 NOTE Place language: English");
    expect(result.output).toContain("2 NOTE Place coordinates: N18.150944, E168.150944");
    expect(result.output).toContain("2 NOTE Place note: External ID: 123");
    expect(result.output).toContain("3 CONT [Type: http://example.com]");
    expect(result.output).toContain("2 NOTE Place note reference: @N1@");
    expect(result.output).toContain("2 NOTE Place source citation");
    expect(result.output).not.toContain("_LANG English");
    expect(result.output).not.toContain("_MAP");
    expect(result.output).not.toContain("_EXID 123");
    expect(result.output).not.toContain("_NOTE @N1@");
    expect(result.output).not.toContain("_SOUR @S1@");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "SOURCE_PLACE_LANGUAGE_NOTED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "SOURCE_PLACE_MAP_NOTED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "EXID_NOTED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "SOURCE_PLACE_NOTE_NOTED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "SOURCE_PLACE_CITATION_NOTED")).toBe(true);
  });

  it("keeps PAGE standard inside legal event source citations", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 BIRT
2 SOUR @S1@
3 PAGE 42
0 @S1@ SOUR
1 TITL Source
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 BIRT");
    expect(result.output).toContain("2 SOUR @S1@");
    expect(result.output).toContain("3 PAGE 42");
    expect(result.output).not.toContain("_PAGE 42");
  });

  it("inlines note-level source citations because GEDCOM 5.5.1 notes cannot nest SOUR structures", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 NOTE Note text
2 SOUR @S1@
3 PAGE 42
0 @S1@ SOUR
1 TITL Source
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 NOTE Note text");
    expect(result.output).toContain("[Source citation @S1@, Page 42]");
    expect(result.output).not.toContain("2 SOUR @S1@");
    expect(result.output).not.toContain("3 PAGE 42");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "NOTE_SOURCE_CITATION_NOTED")).toBe(true);
  });

  it("also inlines demoted _SOUR citations inside note-like text", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 @I1@ INDI
1 NOTE Note text
2 _SOUR @S1@
3 _PAGE 42
0 @S1@ SOUR
1 TITL Source
0 TRLR`;

    const result = convertGedcom(input, {
      from: "5.5.1",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 NOTE Note text");
    expect(result.output).toContain("[Source citation @S1@, Page 42]");
    expect(result.output).not.toContain("2 _SOUR @S1@");
    expect(result.output).not.toContain("3 _PAGE 42");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "NOTE_SOURCE_CITATION_NOTED")).toBe(true);
  });

  it("hoists unsupported file formats and file translations into object notes", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @O1@ OBJE
1 FILE media/original.mp3
2 FORM audio/mp3
3 MEDI AUDIO
2 TRAN media/derived.oga
3 FORM audio/ogg
2 TRAN media/transcript.vtt
3 FORM text/vtt
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).not.toContain("2 _FORM mp3");
    expect(result.output).not.toContain("2 _TRAN media/derived.oga");
    expect(result.output).not.toContain("2 _TRAN media/transcript.vtt");
    expect(result.output).toContain("1 NOTE File format: mp3");
    expect(result.output).toContain("1 NOTE File reference: media/original.mp3");
    expect(result.output).toContain("1 NOTE File translation: media/derived.oga");
    expect(result.output).toContain("[Format: audio/ogg]");
    expect(result.output).toContain("1 NOTE File translation: media/transcript.vtt");
    expect(result.output).toContain("[Format: text/vtt]");
    expect(result.output).not.toContain("_FILE media/original.mp3");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FILE_TRANSLATION_NOTED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FILE_FORMAT_NOTED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FILE_REFERENCE_NOTED")).toBe(true);
  });

  it("hoists unsupported object titles and crop rectangles into object notes", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @O1@ OBJE
1 FILE media/original.mp3
2 FORM audio/mp3
3 MEDI AUDIO
2 TITL Object title
2 CROP
3 TOP 0
3 LEFT 0
3 HEIGHT 100
3 WIDTH 100
1 TITL Root title
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 NOTE File title: Object title");
    expect(result.output).toContain("1 NOTE Crop: top 0, left 0, height 100, width 100");
    expect(result.output).toContain("1 NOTE Object title: Root title");
    expect(result.output).not.toContain("_TITL");
    expect(result.output).not.toContain("_CROP");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FILE_TITLE_NOTED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FILE_CROP_NOTED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "OBJECT_TITLE_NOTED")).toBe(true);
  });

  it("hoists object-link notes up to the parent instead of leaving NOTE under OBJE pointers", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @U1@ SUBM
1 NAME Submitter
1 OBJE @O1@
2 CROP
3 TOP 0
3 LEFT 0
2 TITL Title
0 @O1@ OBJE
1 FILE media/photo.jpg
2 FORM image/jpeg
3 MEDI PHOTO
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 OBJE @O1@");
    expect(result.output).toContain("NOTE Crop: top 0, left 0");
    expect(result.output).toContain("NOTE Object title: Title");
    expect(result.output).not.toContain("2 OBJE @O1@\n2 NOTE Crop: top 0, left 0");
    expect(result.output).not.toContain("2 OBJE @O1@\n2 NOTE Object title: Title");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "OBJECT_LINK_NOTE_HOISTED")).toBe(true);
  });

  it("preserves repository call-number media phrases as notes when 5.5.1 has no equivalent MEDI slot", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @S1@ SOUR
1 REPO @R1@
2 CALN Call number
3 MEDI BOOK
4 PHRASE Booklet
0 @R1@ REPO
1 NAME Repository
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 REPO @R1@");
    expect(result.output).toContain("2 CALN Call number");
    expect(result.output).toContain("3 MEDI BOOK");
    expect(result.output).toContain("2 NOTE Call number media phrase: Booklet");
    expect(result.output).not.toContain("_PHRASE Booklet");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "CALN_MEDI_PHRASE_NOTED")).toBe(true);
  });

  it("rewrites inline notes whose continuation text starts with @ into legal GEDCOM 5.5.1 note text", () => {
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

    expect(result.output).toContain("1 NOTE First line");
    expect(result.output).toContain("2 CONT Text: @handle");
    expect(result.output).not.toContain("1 _NOTE First line");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "AT_CONTINUATION_NOTED")).toBe(true);
  });

  it("maps UID and EXID fallbacks to REFN where GEDCOM 5.5.1 can carry them", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 UID 123e4567-e89b-12d3-a456-426614174000
1 EXID 42
2 TYPE https://example.com/custom-id
0 @U1@ SUBM
1 UID submitter-uid
1 EXID 99
2 TYPE https://example.com/submitter-id
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("0 @I1@ INDI");
    expect(result.output).toContain("1 NOTE UID: 123e4567-e89b-12d3-a456-426614174000");
    expect(result.output).toContain("1 REFN 42");
    expect(result.output).toContain("2 TYPE https://example.com/custom-id");
    expect(result.output).toContain("0 @U1@ SUBM");
    expect(result.output).toContain("1 NOTE UID: submitter-uid");
    expect(result.output).toContain("1 NOTE External ID: 99");
    expect(result.output).toContain("2 CONT [Type: https://example.com/submitter-id]");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "EXID_TO_REFN")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "EXID_PRESERVED")).toBe(true);
  });

  it("merges multiple preserved UID values into note text", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @I1@ INDI
1 UID 123e4567-e89b-12d3-a456-426614174000
1 UID 223e4567-e89b-12d3-a456-426614174000
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("1 NOTE UID: 123e4567-e89b-12d3-a456-426614174000");
    expect(result.output).toContain("2 CONT 223e4567-e89b-12d3-a456-426614174000");
    expect((result.output.match(/\n1 NOTE UID:/g) ?? [])).toHaveLength(1);
    expect(result.output).not.toContain("_UID");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "UIDS_MERGED")).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "UID_NOTED")).toBe(true);
  });

  it("flattens generated child NOTE metadata into shared note record text", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @N1@ SNOTE Shared note
1 UID abc-123
1 CREA
2 DATE 1 JAN 1900
3 TIME 01:02:03
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("0 @N1@ NOTE Shared note");
    expect(result.output).toContain("1 CONT Creation date: 1 JAN 1900");
    expect(result.output).toContain("1 REFN abc-123");
    expect(result.output).toContain("2 TYPE UUID");
    expect(result.output).not.toMatch(/\n1 NOTE Creation date:/);
    expect(result.output).not.toMatch(/\n1 NOTE UID:/);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "NOTE_CHILD_FLATTENED")).toBe(true);
  });

  it("only uses REFN for identifier fallbacks at supported top-level locations", () => {
    const input = `0 HEAD
1 GEDC
2 VERS 7.0.18
0 @F1@ FAM
1 MARR
2 EXID 12
3 TYPE https://example.com/marr-id
0 @S1@ SOUR
1 DATA
2 EVEN BIRT
3 PLAC Somewhere
4 EXID 34
5 TYPE https://example.com/place-id
0 TRLR`;

    const result = convertGedcom(input, {
      from: "7.0.18",
      to: "5.5.1"
    });

    expect(result.output).toContain("2 NOTE External ID: 12");
    expect(result.output).toContain("3 CONT [Type: https://example.com/marr-id]");
    expect(result.output).not.toContain("2 REFN 12");
    expect(result.output).not.toContain("4 REFN 34");
    expect(result.output).toContain("2 NOTE Place note: External ID: 34");
  });

  it("parses and converts selected official GEDCOM 7 test files", () => {
    const officialFiles = [
      "official/gedcom70/escapes.ged",
      "official/gedcom70/lang.ged",
      "official/gedcom70/notes-1.ged",
      "official/gedcom70/obje-1.ged",
      "official/gedcom70/voidptr.ged",
      "official/gedcom70/xref.ged",
      "official/gedcom70/maximal70-lds.ged",
      "official/gedcom70/maximal70-memories2.ged",
      "official/gedcom70/maximal70-tree2.ged",
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
      "VOID_POINTER_NOTED",
      "VOID_POINTER_NOTED",
      "FILE_REFERENCE_NOTED",
      "FILE_FORMAT_NOTED",
      "FILE_REFERENCE_NOTED",
      "FILE_FORMAT_NOTED",
      "FILE_REFERENCE_DEGRADED",
      "FILE_REFERENCE_NOTED",
      "FILE_FORMAT_NOTED"
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
      "FILE_REFERENCE_DEGRADED",
      "FILE_REFERENCE_NOTED",
      "FILE_FORMAT_NOTED",
      "FILE_REFERENCE_NOTED",
      "FILE_FORMAT_NOTED",
      "FILE_REFERENCE_NOTED",
      "FILE_FORMAT_NOTED",
      "FILE_REFERENCE_NOTED",
      "FILE_FORMAT_NOTED",
      "FILE_REFERENCE_NOTED",
      "FILE_FORMAT_NOTED",
      "FILE_REFERENCE_NOTED",
      "FILE_REFERENCE_NOTED",
      "FILE_FORMAT_NOTED",
      "FILE_REFERENCE_NOTED",
      "FILE_FORMAT_NOTED"
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
    expect(result.output).not.toMatch(/\n\d+ _UID\b/);
    expect(result.output).not.toMatch(/\n\d+ _CREA\b/);
    expect(result.output).not.toMatch(/\n\d+ TRAN\b/);
    expect(result.output).not.toMatch(/\n\d+ PHRASE\b/);
    expect(result.output).not.toContain(" FORM jpeg");
    expect(result.output).not.toContain(" TYPE other");
    expect(result.output).toContain("Second child");
    expect(result.output).toContain("Mr Stockdale");
    expect(result.output).toContain("Adoption phrase");
    expect(result.output).toContain("copyright statement");
    expect(result.output).toContain("HEAD-SOUR-DATA");
  });

  it("preserves key maximal70 source content even when 5.5.1 requires structural rewriting", () => {
    const result = convertGedcom(readFixture("official/gedcom70/maximal70.ged"), {
      from: "7.0.18",
      to: "5.5.1"
    });

    const mustPreserve = [
      "This file is intended to provide coverage of parts of the specification and does not contain meaningful historical or genealogical data.",
      "Diese Datei soll Teile der Spezifikation abdecken",
      "HEAD-SOUR-DATA",
      "copyright statement",
      "another copyright statement",
      "1 NOV 2022",
      "8:38",
      "10 JUN 2022",
      "15:43:20.48",
      "Transmission time zone: Z",
      "Entire source",
      "Second child",
      "Clergy",
      "Adoption phrase",
      "Mr Stockdale",
      "Challenged",
      "Foster",
      "Sealing",
      "Other type",
      "Phrase"
    ];

    for (const value of mustPreserve) {
      expect(result.output).toContain(value);
    }
  });
});
