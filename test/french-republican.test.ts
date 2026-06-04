import { describe, expect, it } from "vitest";
import { convertGedcom, parseGedcom } from "../src/index.js";
import { FRENCH_REPUBLICAN_MONTH_TAGS } from "../src/mappings/date/calendar-validation.js";

// GED-13 — French Republican calendar month-tag round-trip + validation.

function doc551(body: string): string {
  return `0 HEAD\n1 SOUR X\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n${body}\n0 TRLR\n`;
}

function doc7(body: string): string {
  return `0 HEAD\n1 SOUR X\n1 GEDC\n2 VERS 7.0.18\n1 CHAR UTF-8\n${body}\n0 TRLR\n`;
}

function dateLine(output: string): string {
  return output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("2 DATE")) ?? "";
}

function up(date: string) {
  return convertGedcom(doc551(`0 @I1@ INDI\n1 DEAT\n2 DATE ${date}`), { from: "5.5.1", to: "7.0.18" });
}

function down(date: string) {
  return convertGedcom(doc7(`0 @I1@ INDI\n1 DEAT\n2 DATE ${date}`), { from: "7.0.18", to: "5.5.1" });
}

describe("GED-13: all 13 French Republican months round-trip", () => {
  for (const [index, month] of FRENCH_REPUBLICAN_MONTH_TAGS.entries()) {
    const day = ((index % 28) + 1).toString();
    const year = (index + 1).toString();
    it(`round-trips @#DFRENCH R@ ${day} ${month} ${year}`, () => {
      const upped = up(`@#DFRENCH R@ ${day} ${month} ${year}`);
      expect(dateLine(upped.output)).toBe(`2 DATE FRENCH_R ${day} ${month} ${year}`);
      expect(() => parseGedcom(upped.output, { version: "7.0.18" })).not.toThrow();
      expect(upped.diagnostics.some((d) => d.code.startsWith("FRENCH_R_"))).toBe(false);

      const downed = convertGedcom(upped.output, { from: "7.0.18", to: "5.5.1" });
      expect(dateLine(downed.output)).toBe(`2 DATE @#DFRENCH R@ ${day} ${month} ${year}`);
    });
  }
});

describe("GED-13: invalid month tag", () => {
  it("emits FRENCH_R_MONTH_INVALID on up-conversion", () => {
    const result = up("@#DFRENCH R@ 1 SMARCH 8");
    expect(result.diagnostics.some((d) => d.code === "FRENCH_R_MONTH_INVALID")).toBe(true);
  });

  it("emits FRENCH_R_MONTH_INVALID on down-conversion", () => {
    const result = down("FRENCH_R 1 SMARCH 8");
    expect(result.diagnostics.some((d) => d.code === "FRENCH_R_MONTH_INVALID")).toBe(true);
  });

  it("does not flag a valid month", () => {
    expect(up("@#DFRENCH R@ 1 BRUM 8").diagnostics.some((d) => d.code === "FRENCH_R_MONTH_INVALID")).toBe(false);
  });
});

describe("GED-13: epoch marker is illegal in this calendar", () => {
  it("emits FRENCH_R_EPOCH_INVALID for a BCE marker (v7)", () => {
    const result = down("FRENCH_R 1 VEND 8 BCE");
    expect(result.diagnostics.some((d) => d.code === "FRENCH_R_EPOCH_INVALID")).toBe(true);
  });

  it("emits FRENCH_R_EPOCH_INVALID for a B.C. marker (5.5.1)", () => {
    const result = up("@#DFRENCH R@ 1 VEND 8 B.C.");
    expect(result.diagnostics.some((d) => d.code === "FRENCH_R_EPOCH_INVALID")).toBe(true);
  });

  it("does not flag an epoch-free French Republican date", () => {
    expect(up("@#DFRENCH R@ 1 VEND 8").diagnostics.some((d) => d.code === "FRENCH_R_EPOCH_INVALID")).toBe(false);
  });
});

describe("GED-13: a non-French-Republican date is never flagged", () => {
  it("ignores a Gregorian date that happens to contain letters", () => {
    expect(up("3 MAR 1900").diagnostics.some((d) => d.code.startsWith("FRENCH_R_"))).toBe(false);
  });
});
