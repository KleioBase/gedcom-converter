import { describe, expect, it } from "vitest";
import { convertGedcom } from "../src/index.js";

const H551 = "0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n";

// A generic `1 EVEN <value>` / `2 TYPE <label>` (e.g. "Language spoken: Hebrew")
// is preserved verbatim rather than having its value stripped to a note. The
// converter does not guess that the EVEN is really a FACT; it keeps what it was
// given.
describe("a generic EVEN value with a TYPE is preserved verbatim, not noted", () => {
  it("keeps the EVEN value and TYPE through a round-trip", () => {
    const input = `${H551}0 @I1@ INDI\n1 EVEN Hebrew\n2 TYPE Language spoken\n0 TRLR`;
    const up = convertGedcom(input, { from: "5.5.1", to: "7.0.18" });
    const back = convertGedcom(up.output, { from: "7.0.18", to: "5.5.1" });
    expect(back.output).toContain("1 EVEN Hebrew");
    expect(back.output).toContain("2 TYPE Language spoken");
    expect(back.output).not.toMatch(/NOTE Event value:/);
  });

  it("does not emit VALUE_NOTED on direct v7 -> 5.5.1 down-conversion", () => {
    const v7 = `0 HEAD\n1 GEDC\n2 VERS 7.0.18\n0 @I1@ INDI\n1 EVEN Hebrew\n2 TYPE Language spoken\n0 TRLR`;
    const result = convertGedcom(v7, { from: "7.0.18", to: "5.5.1" });
    expect(result.output).toContain("1 EVEN Hebrew");
    expect(result.diagnostics.some((d) => d.code === "VALUE_NOTED")).toBe(false);
  });

  // A canonical valueless family event — `1 EVEN` / `2 TYPE <classification>` —
  // must keep its TYPE child; the classification is not collapsed onto the EVEN
  // line. (Ancestry exports use this form for Marriage/Separation/etc.)
  it("keeps a valueless FAM EVEN's TYPE child rather than promoting it to a value", () => {
    const input = `${H551}0 @F1@ FAM\n1 EVEN\n2 TYPE Marriage\n2 DATE 1 JAN 1900\n0 TRLR`;
    const up = convertGedcom(input, { from: "5.5.1", to: "7.0.18" });
    const back = convertGedcom(up.output, { from: "7.0.18", to: "5.5.1" });
    expect(back.output).toMatch(/\n1 EVEN\n/);
    expect(back.output).toMatch(/\n2 TYPE Marriage/);
    expect(back.output).not.toMatch(/\n1 EVEN Marriage/);
  });

  it("still restores a value-form FAM event (1 FACT Fact -> 1 EVEN Fact)", () => {
    const v7 = `0 HEAD\n1 GEDC\n2 VERS 7.0.18\n0 @F1@ FAM\n1 FACT Fact\n0 TRLR`;
    const result = convertGedcom(v7, { from: "7.0.18", to: "5.5.1" });
    expect(result.output).toContain("1 EVEN Fact");
  });
});
