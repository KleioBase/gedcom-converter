import { describe, expect, it } from "vitest";
import { convertGedcom, parseGedcom } from "../src/index.js";

// GED-11 — full date round-trip across phrases, ranges, periods, dual dates,
// mixed-calendar ranges and partial dates, in both conversion directions.
//
// Tolerance: the only lossy date construct is the v7 PHRASE substructure. A v7
// `DATE <date>` + `PHRASE <text>` collapses to a 5.5.1 `INT <date> (<text>)`
// (interpreted date); a v7 `DATE` with an empty payload + `PHRASE` collapses to
// `(<text>)`. Both reconstruct exactly on the way back. Everything else is a
// lexical round-trip (calendar keyword ↔ escape, `BCE` ↔ `B.C.`).

function doc551(body: string): string {
  return `0 HEAD\n1 SOUR X\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n${body}\n0 TRLR\n`;
}

function doc7(body: string): string {
  return `0 HEAD\n1 SOUR X\n1 GEDC\n2 VERS 7.0.18\n1 CHAR UTF-8\n${body}\n0 TRLR\n`;
}

/** Up-convert a single 5.5.1 DEAT.DATE and return the resulting DATE/PHRASE lines. */
function up(date: string): { lines: string; output: string } {
  const result = convertGedcom(doc551(`0 @I1@ INDI\n1 DEAT\n2 DATE ${date}`), {
    from: "5.5.1",
    to: "7.0.18"
  });
  // Every up-converted document must be valid GEDCOM 7.
  expect(() => parseGedcom(result.output, { version: "7.0.18" })).not.toThrow();
  return { lines: dateLines(result.output), output: result.output };
}

/** Down-convert a single 7.0.18 DEAT.DATE and return the resulting DATE/PHRASE lines. */
function down(body: string): { lines: string; output: string } {
  const result = convertGedcom(doc7(`0 @I1@ INDI\n1 DEAT\n${body}`), {
    from: "7.0.18",
    to: "5.5.1"
  });
  expect(() => parseGedcom(result.output, { version: "5.5.1" })).not.toThrow();
  return { lines: dateLines(result.output), output: result.output };
}

/** 5.5.1 → v7 → 5.5.1 of a DEAT.DATE; returns the final DATE line text. */
function roundTrip551(date: string): string {
  const upped = convertGedcom(doc551(`0 @I1@ INDI\n1 DEAT\n2 DATE ${date}`), {
    from: "5.5.1",
    to: "7.0.18"
  });
  const downed = convertGedcom(upped.output, { from: "7.0.18", to: "5.5.1" });
  return dateLines(downed.output);
}

function dateLines(output: string): string {
  return output
    .split("\n")
    .filter((line) => /^\d+ (DATE|PHRASE)\b/.test(line.trim()))
    .map((line) => line.trim())
    .join("\n");
}

describe("GED-11: date ranges (BET/AND, AFT, BEF)", () => {
  const cases = ["BET 1900 AND 1910", "BET 1900 AND JAN 1910", "AFT 1850", "BEF 1850"];
  for (const value of cases) {
    it(`round-trips "${value}" unchanged`, () => {
      expect(up(value).lines).toBe(`2 DATE ${value}`);
      expect(roundTrip551(value)).toBe(`2 DATE ${value}`);
    });
  }
});

describe("GED-11: date approximations (ABT, CAL, EST)", () => {
  for (const value of ["ABT 1850", "CAL 1850", "EST 1850"]) {
    it(`round-trips "${value}" unchanged`, () => {
      expect(up(value).lines).toBe(`2 DATE ${value}`);
      expect(roundTrip551(value)).toBe(`2 DATE ${value}`);
    });
  }
});

describe("GED-11: date periods (FROM/TO, open-ended)", () => {
  for (const value of ["FROM 1900 TO 1910", "FROM 1900", "TO 1910"]) {
    it(`round-trips "${value}" unchanged`, () => {
      expect(up(value).lines).toBe(`2 DATE ${value}`);
      expect(roundTrip551(value)).toBe(`2 DATE ${value}`);
    });
  }
});

describe("GED-11: partial dates", () => {
  for (const value of ["1900", "MAR 1900", "15 MAR 1900"]) {
    it(`round-trips "${value}" unchanged`, () => {
      expect(up(value).lines).toBe(`2 DATE ${value}`);
      expect(roundTrip551(value)).toBe(`2 DATE ${value}`);
    });
  }
});

describe("GED-11: date phrases (§2.4 — phrases moved to PHRASE in v7)", () => {
  it("up: interpreted INT date → DATE payload + PHRASE", () => {
    expect(up("INT 1900 (about then)").lines).toBe("2 DATE 1900\n3 PHRASE about then");
  });

  it("up: bare (phrase) → empty DATE payload + PHRASE", () => {
    expect(up("(stardate unknown)").lines).toBe("2 DATE\n3 PHRASE stardate unknown");
  });

  it("down: DATE + PHRASE → 5.5.1 INT date (phrase)", () => {
    expect(down("2 DATE 1900\n3 PHRASE about then").lines).toBe("2 DATE INT 1900 (about then)");
  });

  it("down: empty DATE + PHRASE → 5.5.1 (phrase)", () => {
    expect(down("2 DATE\n3 PHRASE stardate unknown").lines).toBe("2 DATE (stardate unknown)");
  });

  it("round-trips interpreted and bare phrases exactly", () => {
    expect(roundTrip551("INT 1900 (about then)")).toBe("2 DATE INT 1900 (about then)");
    expect(roundTrip551("(stardate unknown)")).toBe("2 DATE (stardate unknown)");
  });
});

describe("GED-11: dual dates (§6.2 Old Style / New Style)", () => {
  for (const value of ["30 JAN 1648/49", "@#DJULIAN@ 30 JAN 1648/49"]) {
    it(`round-trips "${value}"`, () => {
      // The dual `year/suffix` survives unchanged; only the calendar escape ↔ keyword flips.
      expect(up(value).lines).toContain("1648/49");
      expect(roundTrip551(value)).toBe(`2 DATE ${value}`);
    });
  }
});

describe("GED-11: mixed-calendar ranges (§6.3)", () => {
  it("up: each date in the range keeps its own calendar", () => {
    expect(up("FROM @#DGREGORIAN@ 1670 TO @#DJULIAN@ 1700").lines).toBe(
      "2 DATE FROM GREGORIAN 1670 TO JULIAN 1700"
    );
  });

  it("round-trips a mixed-calendar period", () => {
    expect(roundTrip551("FROM @#DGREGORIAN@ 1670 TO @#DJULIAN@ 1700")).toBe(
      "2 DATE FROM @#DGREGORIAN@ 1670 TO @#DJULIAN@ 1700"
    );
  });
});

describe("GED-11: BCE / B.C. era markers", () => {
  it("up: 5.5.1 B.C. → v7 BCE (Julian)", () => {
    expect(up("@#DJULIAN@ 44 B.C.").lines).toBe("2 DATE JULIAN 44 BCE");
  });

  it("down: v7 BCE → 5.5.1 B.C.", () => {
    expect(down("2 DATE 44 BCE").lines).toBe("2 DATE 44 B.C.");
  });

  it("round-trips a Julian BCE date", () => {
    expect(roundTrip551("@#DJULIAN@ 44 B.C.")).toBe("2 DATE @#DJULIAN@ 44 B.C.");
  });
});
