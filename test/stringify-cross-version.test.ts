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
