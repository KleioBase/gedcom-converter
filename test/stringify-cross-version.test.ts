import { describe, expect, it } from "vitest";
import { convertGedcom, parseGedcom, parseGedcomZip, stringifyGedcom, stringifyGedcomZip } from "../src/index.js";
import type { Diagnostic } from "../src/types.js";

// `stringifyGedcom` targeting a version other than the document's own must apply
// the same cross-version mapping `convertGedcom` does; serializing a v7 document
// as 5.5.1 otherwise leaks v7 enum casing and v7-only tags.

const V7 = [
  "0 HEAD",
  "1 GEDC",
  "2 VERS 7.0.18",
  "1 SOUR KleioBase",
  "0 @I1@ INDI",
  "1 NAME Anna /Smith/",
  "2 TYPE MAIDEN",
  "1 FAMC @F1@",
  "2 PEDI BIRTH",
  "1 NO MARR",
  "0 @F1@ FAM",
  "1 CHIL @I1@",
  "0 TRLR",
  ""
].join("\n");

const V551 = [
  "0 HEAD",
  "1 SOUR KleioBase",
  "1 GEDC",
  "2 VERS 5.5.1",
  "2 FORM LINEAGE-LINKED",
  "1 CHAR UTF-8",
  "1 SUBM @SUBM1@",
  "0 @I1@ INDI",
  "1 NAME Anna /Smith/",
  "2 TYPE maiden",
  "1 FAMC @F1@",
  "2 PEDI birth",
  "0 @F1@ FAM",
  "1 CHIL @I1@",
  "0 @SUBM1@ SUBM",
  "1 NAME KleioBase",
  "0 TRLR",
  ""
].join("\n");

// 5.5.1 spells its enumerations lowercase — RESTRICTION_NOTICE (p.60) is a
// closed lowercase set, NAME_TYPE (p.56) is lowercase plus `<user defined>` —
// where the corresponding v7 enum sets are uppercase.
const V7_ENUMS = [
  "0 HEAD",
  "1 GEDC",
  "2 VERS 7.0.18",
  "1 SOUR KleioBase",
  "0 @I1@ INDI",
  "1 RESN CONFIDENTIAL",
  "1 NAME M. Q. /Blum/",
  "2 TYPE PROFESSIONAL",
  "0 TRLR",
  ""
].join("\n");

describe("stringifyGedcom cross-version mapping", () => {
  it("emits 5.5.1 lowercase NAME.TYPE and PEDI enumerations from a v7 document", () => {
    const output = stringifyGedcom(parseGedcom(V7), { version: "5.5.1" });

    expect(output).toContain("2 TYPE maiden");
    expect(output).toContain("2 PEDI birth");
    expect(output).not.toContain("2 TYPE MAIDEN");
    expect(output).not.toContain("2 PEDI BIRTH");
  });

  it("does not emit the v7-only NO tag in 5.5.1 output", () => {
    const output = stringifyGedcom(parseGedcom(V7), { version: "5.5.1" });

    expect(output).not.toMatch(/^\d+ NO(?: |$)/m);
  });

  it("agrees with convertGedcom for the same v7 input", () => {
    const viaStringify = stringifyGedcom(parseGedcom(V7), { version: "5.5.1" });
    const viaConvert = convertGedcom(V7, { from: "7.0.18", to: "5.5.1" }).output;

    expect(viaStringify).toBe(viaConvert);
  });

  it("agrees with convertGedcom in the 5.5.1 to v7 direction", () => {
    const viaStringify = stringifyGedcom(parseGedcom(V551), { version: "7.0.18" });
    const viaConvert = convertGedcom(V551, { from: "5.5.1", to: "7.0.18" }).output;

    expect(viaStringify).toBe(viaConvert);
  });

  it("collects mapping diagnostics into the optional sink", () => {
    const diagnostics: Diagnostic[] = [];

    stringifyGedcom(parseGedcom(V7), { version: "5.5.1", diagnostics });

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((diagnostic) => diagnostic.location?.tag === "NO")).toBe(true);
  });

  it("leaves a same-version serialization untouched", () => {
    const document = parseGedcom(V7);

    expect(stringifyGedcom(document, { version: "7.0.18" })).toBe(
      stringifyGedcom(parseGedcom(stringifyGedcom(document, { version: "7.0.18" })), { version: "7.0.18" })
    );
  });

  it("does not apply the lossy 5.5.1 sanitizer to an already-5.5.1 document", () => {
    // The sanitizer rewrites `@`-prefixed continuation lines, which conversion
    // accepts but plain serialization must not: stringify is not a conversion.
    const document = parseGedcom(V551);
    document.records[0]!.children.push({ level: 1, tag: "NOTE", value: "line one\n@home address", children: [] });

    const output = stringifyGedcom(document, { version: "5.5.1" });

    expect(output).not.toContain("Text: @home address");
    expect(parseGedcom(output).records[0]!.children.find((child) => child.tag === "NOTE")?.value).toBe(
      "line one\n@home address"
    );
  });

  it("emits the 5.5.1 RESN and NAME.TYPE spellings from a v7 document", () => {
    const output = stringifyGedcom(parseGedcom(V7_ENUMS), { version: "5.5.1" });

    expect(output).toContain("1 RESN confidential");
    expect(output).toContain("2 TYPE professional");
    expect(output).not.toContain("1 RESN CONFIDENTIAL");
    expect(output).not.toContain("2 TYPE PROFESSIONAL");
  });

  it("agrees with convertGedcom on the 5.5.1 enum spellings", () => {
    expect(stringifyGedcom(parseGedcom(V7_ENUMS), { version: "5.5.1" })).toBe(
      convertGedcom(V7_ENUMS, { from: "7.0.18", to: "5.5.1" }).output
    );
  });

  it("keeps the v7 enum spellings when the target is 7.0.18", () => {
    const output = stringifyGedcom(parseGedcom(V7_ENUMS), { version: "7.0.18" });

    expect(output).toContain("1 RESN CONFIDENTIAL");
    expect(output).toContain("2 TYPE PROFESSIONAL");
  });

  it("leaves an already-5.5.1 RESN value alone and raises no diagnostic", () => {
    const input = [
      "0 HEAD",
      "1 SOUR KleioBase",
      "1 GEDC",
      "2 VERS 5.5.1",
      "2 FORM LINEAGE-LINKED",
      "1 CHAR UTF-8",
      "0 @I1@ INDI",
      "1 RESN confidential",
      "0 TRLR",
      ""
    ].join("\n");

    const result = convertGedcom(input, { from: "5.5.1", to: "5.5.1" });

    expect(result.output).toContain("1 RESN confidential");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "RESN_REDUCED")).toBe(false);
  });

  it("still reduces a v7 RESN list to a single 5.5.1 value", () => {
    const input = [
      "0 HEAD",
      "1 GEDC",
      "2 VERS 7.0.18",
      "1 SOUR KleioBase",
      "0 @I1@ INDI",
      "1 RESN CONFIDENTIAL, LOCKED",
      "0 TRLR",
      ""
    ].join("\n");

    const result = convertGedcom(input, { from: "7.0.18", to: "5.5.1" });

    expect(result.output).toContain("1 RESN confidential");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "RESN_REDUCED")).toBe(true);
  });

  it("leaves an already-5.5.1 source media type alone rather than up-casing it", () => {
    // SOURCE_MEDIA_TYPE is closed and lowercase in 5.5.1, so a spec-correct
    // value must survive a 5.5.1 target untouched — in both of its locations.
    const input = [
      "0 HEAD",
      "1 SOUR KleioBase",
      "1 GEDC",
      "2 VERS 5.5.1",
      "2 FORM LINEAGE-LINKED",
      "1 CHAR UTF-8",
      "0 @O1@ OBJE",
      "1 FILE p.jpg",
      "2 FORM jpg",
      "3 TYPE photo",
      "0 @S1@ SOUR",
      "1 TITL T",
      "1 REPO @R1@",
      "2 CALN 12",
      "3 MEDI book",
      "0 @R1@ REPO",
      "1 NAME R",
      "0 TRLR",
      ""
    ].join("\n");

    const result = convertGedcom(input, { from: "5.5.1", to: "5.5.1" });

    expect(result.output).toContain("3 TYPE photo");
    expect(result.output).toContain("3 MEDI book");
    expect(result.output).not.toContain("3 TYPE PHOTO");
    expect(result.output).not.toContain("3 MEDI BOOK");
  });

  it("maps the gedcom.ged entry inside a GEDZIP archive", async () => {
    const archive = await stringifyGedcomZip(parseGedcom(V7), new Map(), { version: "5.5.1" });
    const parsed = await parseGedcomZip(archive);

    const individual = parsed.document.records.find((record) => record.tag === "INDI")!;
    const nameType = individual.children
      .find((child) => child.tag === "NAME")!
      .children.find((child) => child.tag === "TYPE");

    expect(parsed.document.version).toBe("5.5.1");
    expect(nameType?.value).toBe("maiden");
    expect(individual.children.some((child) => child.tag === "NO")).toBe(false);
  });
});
