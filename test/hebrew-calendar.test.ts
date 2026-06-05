import { describe, expect, it } from "vitest";
import { convertGedcom } from "../src/index.js";
import { isHebrewLeapYear, resolveHebrewAdar } from "../src/mappings/date/hebrew.js";

// Hebrew ADR (Adar I) / ADS (Adar II) leap-year resolution.
//
// NOTE: the Linear ticket's acceptance examples have the years swapped. The
// Metonic rule `(7y+1) mod 19 < 7` and the real calendar agree that 5784 IS a
// leap year (it had Adar I + Adar II; Purim fell in Adar II, March 2024) and
// 5783 is a common year. These tests assert the mathematically correct values.

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

describe("isHebrewLeapYear", () => {
  it("matches the Metonic leap-year cycle (3,6,8,11,14,17,19)", () => {
    expect(isHebrewLeapYear(5784)).toBe(true); // common-era 2023/24, two Adars
    expect(isHebrewLeapYear(5783)).toBe(false); // single Adar
    expect(isHebrewLeapYear(5782)).toBe(true);
    expect(isHebrewLeapYear(5785)).toBe(false);
    // Whole 19-year cycle starting at 5701 (year-of-cycle 1).
    const leapYearsInCycle = Array.from({ length: 19 }, (_, i) => 5700 + i + 1).filter(isHebrewLeapYear);
    expect(leapYearsInCycle.map((y) => ((y - 1) % 19) + 1).sort((a, b) => a - b)).toEqual([3, 6, 8, 11, 14, 17, 19]);
  });
});

describe("resolveHebrewAdar (pure)", () => {
  it("corrects ADR → ADS in a common year", () => {
    expect(resolveHebrewAdar("HEBREW 15 ADR 5783")).toEqual({ value: "HEBREW 15 ADS 5783", corrected: true });
  });

  it("preserves ADR in a leap year", () => {
    expect(resolveHebrewAdar("HEBREW 15 ADR 5784")).toEqual({ value: "HEBREW 15 ADR 5784", corrected: false });
  });

  it("ignores ADR when no Hebrew calendar marker is present", () => {
    expect(resolveHebrewAdar("15 ADR 5783")).toEqual({ value: "15 ADR 5783", corrected: false });
  });

  it("handles each date in a Hebrew range independently", () => {
    // 5783 common → ADS; 5784 leap → ADR kept.
    expect(resolveHebrewAdar("BET HEBREW ADR 5783 AND HEBREW ADR 5784").value).toBe(
      "BET HEBREW ADS 5783 AND HEBREW ADR 5784"
    );
  });
});

describe("5.5.1 → v7 up-conversion", () => {
  it("corrects ADR → ADS for a common year and emits a diagnostic", () => {
    const result = convertGedcom(doc551("0 @I1@ INDI\n1 DEAT\n2 DATE @#DHEBREW@ 15 ADR 5783"), {
      from: "5.5.1",
      to: "7.0.18"
    });
    expect(dateLine(result.output)).toBe("2 DATE HEBREW 15 ADS 5783");
    expect(result.diagnostics.some((d) => d.code === "HEBREW_ADAR_CORRECTED")).toBe(true);
  });

  it("preserves ADR for a leap year (no diagnostic)", () => {
    const result = convertGedcom(doc551("0 @I1@ INDI\n1 DEAT\n2 DATE @#DHEBREW@ 15 ADR 5784"), {
      from: "5.5.1",
      to: "7.0.18"
    });
    expect(dateLine(result.output)).toBe("2 DATE HEBREW 15 ADR 5784");
    expect(result.diagnostics.some((d) => d.code === "HEBREW_ADAR_CORRECTED")).toBe(false);
  });
});

describe("v7 → 5.5.1 down-conversion", () => {
  it("corrects ADR → ADS for a common year", () => {
    const result = convertGedcom(doc7("0 @I1@ INDI\n1 DEAT\n2 DATE HEBREW 15 ADR 5783"), {
      from: "7.0.18",
      to: "5.5.1"
    });
    expect(dateLine(result.output)).toBe("2 DATE @#DHEBREW@ 15 ADS 5783");
    expect(result.diagnostics.some((d) => d.code === "HEBREW_ADAR_CORRECTED")).toBe(true);
  });

  it("preserves an already-correct ADS", () => {
    const result = convertGedcom(doc7("0 @I1@ INDI\n1 DEAT\n2 DATE HEBREW 15 ADS 5783"), {
      from: "7.0.18",
      to: "5.5.1"
    });
    expect(dateLine(result.output)).toBe("2 DATE @#DHEBREW@ 15 ADS 5783");
    expect(result.diagnostics.some((d) => d.code === "HEBREW_ADAR_CORRECTED")).toBe(false);
  });
});

describe("round-trip preserves the correction", () => {
  it("5.5.1 ADR (common year) → v7 ADS → 5.5.1 ADS", () => {
    const upped = convertGedcom(doc551("0 @I1@ INDI\n1 DEAT\n2 DATE @#DHEBREW@ 15 ADR 5783"), {
      from: "5.5.1",
      to: "7.0.18"
    });
    const downed = convertGedcom(upped.output, { from: "7.0.18", to: "5.5.1" });
    expect(dateLine(downed.output)).toBe("2 DATE @#DHEBREW@ 15 ADS 5783");
  });
});
