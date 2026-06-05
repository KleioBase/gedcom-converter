import { describe, expect, it } from "vitest";
import { convertGedcom } from "../src/index.js";

const H551 = "0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n";

const roundTrip = (input: string) =>
  convertGedcom(convertGedcom(input, { from: "5.5.1", to: "7.0.18" }).output, {
    from: "7.0.18",
    to: "5.5.1"
  });

describe("AGE round-trips as a free-form 5.5.1 value, not a note", () => {
  // GEDCOM 5.5.1 AGE_AT_EVENT is free-form, so a value v7 can only hold as a
  // PHRASE (a bare number, a range, an approximation) is restored to the AGE
  // value on the way back rather than being demoted to a note.

  it("restores a non-numeric AGE (a range) through a round-trip", () => {
    const back = roundTrip(`${H551}0 @I1@ INDI\n1 DEAT\n2 AGE About 19-20\n0 TRLR`);
    expect(back.output).toContain("2 AGE About 19-20");
    expect(back.output).not.toMatch(/NOTE Age phrase:/);
  });

  it("restores a bare-number AGE through a round-trip", () => {
    const back = roundTrip(`${H551}0 @I1@ INDI\n1 DEAT\n2 AGE 13\n0 TRLR`);
    expect(back.output).toContain("2 AGE 13");
    expect(back.output).not.toMatch(/NOTE Age phrase:/);
  });

  it("keeps a structured AGE plus a clarifying phrase (phrase still noted)", () => {
    // When the AGE carries a real v7 value, the extra PHRASE is supplementary
    // and is still hoisted to a note.
    const v7 = `0 HEAD\n1 GEDC\n2 VERS 7.0.18\n0 @I1@ INDI\n1 DEAT\n2 AGE 72y\n3 PHRASE in his prime\n0 TRLR`;
    const back = convertGedcom(v7, { from: "7.0.18", to: "5.5.1" });
    expect(back.output).toContain("2 AGE 72y");
    expect(back.output).toMatch(/Age phrase: in his prime/);
  });
});

describe("OBJE titles are preserved under FILE, not flattened to notes", () => {
  it("keeps a 5.5-style OBJE TITL (sibling of FILE) as a structured title", () => {
    const input = `${H551}0 @I1@ INDI\n1 OBJE\n2 FORM jpg\n2 FILE https://media.example.com/photo.jpg\n2 TITL Family portrait\n0 TRLR`;
    const back = roundTrip(input);
    expect(back.output).toMatch(/\d+ TITL Family portrait/);
    expect(back.output).not.toMatch(/NOTE Object title:/);
    expect(back.output).not.toMatch(/NOTE File title:/);
  });
});
