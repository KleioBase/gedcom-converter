import { describe, expect, it } from "vitest";
import { convertGedcom, parseGedcom } from "../src/index.js";

// Julian epoch markers (BCE ↔ B.C.) and undefined legacy calendars
// (ROMAN / UNKNOWN).

function doc551(body: string): string {
  return `0 HEAD\n1 SOUR X\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n${body}\n0 TRLR\n`;
}

function doc7(body: string): string {
  return `0 HEAD\n1 SOUR X\n1 GEDC\n2 VERS 7.0.18\n1 CHAR UTF-8\n${body}\n0 TRLR\n`;
}

function lines(output: string): string {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+ (DATE|PHRASE)\b/.test(line))
    .join(" / ");
}

function up(date: string) {
  return convertGedcom(doc551(`0 @I1@ INDI\n1 DEAT\n2 DATE ${date}`), { from: "5.5.1", to: "7.0.18" });
}

function down(date: string) {
  return convertGedcom(doc7(`0 @I1@ INDI\n1 DEAT\n2 DATE ${date}`), { from: "7.0.18", to: "5.5.1" });
}

function roundTrip551(date: string): string {
  const upped = up(date);
  return lines(convertGedcom(upped.output, { from: "7.0.18", to: "5.5.1" }).output);
}

describe("Julian epoch markers", () => {
  it("up: 5.5.1 B.C. → v7 BCE", () => {
    const result = up("@#DJULIAN@ 15 MAR 44 B.C.");
    expect(lines(result.output)).toBe("2 DATE JULIAN 15 MAR 44 BCE");
    expect(() => parseGedcom(result.output, { version: "7.0.18" })).not.toThrow();
  });

  it("down: v7 BCE → 5.5.1 B.C.", () => {
    const result = down("JULIAN 15 MAR 44 BCE");
    expect(lines(result.output)).toBe("2 DATE @#DJULIAN@ 15 MAR 44 B.C.");
    expect(() => parseGedcom(result.output, { version: "5.5.1" })).not.toThrow();
  });

  it("round-trips a Julian BCE date exactly", () => {
    expect(roundTrip551("@#DJULIAN@ 15 MAR 44 B.C.")).toBe("2 DATE @#DJULIAN@ 15 MAR 44 B.C.");
  });

  it("round-trips a year-only Julian date", () => {
    expect(roundTrip551("@#DJULIAN@ 1582")).toBe("2 DATE @#DJULIAN@ 1582");
  });

  it("round-trips a date across the Gregorian/Julian transition", () => {
    // 4 Oct 1582 (Julian) is the day before the Gregorian calendar's 15 Oct 1582.
    expect(roundTrip551("@#DJULIAN@ 4 OCT 1582")).toBe("2 DATE @#DJULIAN@ 4 OCT 1582");
  });
});

describe("legacy ROMAN / UNKNOWN calendars (undefined)", () => {
  it("up: ROMAN escape → empty DATE + PHRASE with UNKNOWN_CALENDAR", () => {
    const result = up("@#DROMAN@ 1 JAN 100");
    expect(lines(result.output)).toBe("2 DATE / 3 PHRASE 1 JAN 100 (Roman calendar)");
    expect(result.diagnostics.some((d) => d.code === "UNKNOWN_CALENDAR")).toBe(true);
    expect(() => parseGedcom(result.output, { version: "7.0.18" })).not.toThrow();
  });

  it("up: UNKNOWN escape → empty DATE + PHRASE with UNKNOWN_CALENDAR", () => {
    const result = up("@#DUNKNOWN@ 1 JAN 100");
    expect(lines(result.output)).toBe("2 DATE / 3 PHRASE 1 JAN 100 (unknown calendar)");
    expect(result.diagnostics.some((d) => d.code === "UNKNOWN_CALENDAR")).toBe(true);
  });

  it("down: a bare ROMAN keyword is re-wrapped in the 5.5.1 escape", () => {
    const result = down("ROMAN 1 JAN 100");
    expect(lines(result.output)).toBe("2 DATE @#DROMAN@ 1 JAN 100");
    expect(result.diagnostics.some((d) => d.code === "UNKNOWN_CALENDAR")).toBe(true);
    expect(() => parseGedcom(result.output, { version: "5.5.1" })).not.toThrow();
  });

  it("never emits a bare, undefined v7 calendar keyword", () => {
    expect(up("@#DROMAN@ 1 JAN 100").output).not.toMatch(/\n2 DATE ROMAN\b/);
    expect(up("@#DUNKNOWN@ 1 JAN 100").output).not.toMatch(/\n2 DATE UNKNOWN\b/);
  });
});
