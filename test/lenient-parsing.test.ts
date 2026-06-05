import { describe, expect, it } from "vitest";
import { parseGedcom, stringifyGedcom, convertGedcom } from "../src/index.js";

// Real-world GEDCOM (notably MyHeritage exports) sometimes contains values with
// unescaped embedded newlines: a physical line with no leading level number,
// continuing the previous line's value. This is malformed per spec, but a single
// such line should not abort the conversion of an otherwise valid file. The
// parser recovers by folding the orphan line into the preceding value and emits
// a `warning` diagnostic so a consumer can choose to treat it as fatal.

const HEAD = "0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n";
const withOrphan =
  `${HEAD}0 @I1@ INDI\n1 NAME Ada /Lovelace/\n1 NOTE Born in London\nBirth: 1815\n0 TRLR`;

describe("line value delimiter is a single space (leading value whitespace is significant)", () => {
  it("preserves a leading space inside a line value through a round-trip", () => {
    const input = `${HEAD}0 @I1@ INDI\n1 OCCU  Head of Academy\n0 TRLR`;
    const up = convertGedcom(input, { from: "5.5.1", to: "7.0.18" });
    const back = convertGedcom(up.output, { from: "7.0.18", to: "5.5.1" });
    expect(back.output).toContain("1 OCCU  Head of Academy");
  });

  it("parses the value after exactly one delimiter space", () => {
    const parsed = parseGedcom(`${HEAD}0 @I1@ INDI\n1 NOTE  two leading spaces become one\n0 TRLR`, {
      version: "5.5.1"
    });
    const note = parsed.records[0]?.children.find((child) => child.tag === "NOTE");
    expect(note?.value).toBe(" two leading spaces become one");
  });
});

describe("lenient parsing of embedded-newline (orphan) lines", () => {
  it("does not throw on an orphan continuation line", () => {
    expect(() => parseGedcom(withOrphan, { version: "5.5.1" })).not.toThrow();
  });

  it("folds the orphan line into the preceding value", () => {
    const doc = parseGedcom(withOrphan, { version: "5.5.1" });
    const note = doc.records[0]?.children.find((c) => c.tag === "NOTE");
    expect(note?.value).toBe("Born in London\nBirth: 1815");
  });

  it("emits a warning diagnostic naming the recovered line", () => {
    const doc = parseGedcom(withOrphan, { version: "5.5.1" });
    const diag = doc.diagnostics.find((d) => d.code === "MALFORMED_LINE_RECOVERED");
    expect(diag?.severity).toBe("warning");
  });

  it("re-serializes the folded value as a CONT continuation", () => {
    const doc = parseGedcom(withOrphan, { version: "5.5.1" });
    const out = stringifyGedcom(doc, { version: "5.5.1" });
    expect(out).toContain("1 NOTE Born in London");
    expect(out).toContain("2 CONT Birth: 1815");
  });

  it("lets a developer force-stop via parseGedcom({ strict: true })", () => {
    expect(() => parseGedcom(withOrphan, { version: "5.5.1", strict: true })).toThrow();
  });

  it("lets a developer force-stop via convertGedcom({ strict: true })", () => {
    expect(() => convertGedcom(withOrphan, { from: "5.5.1", to: "7.0.18", strict: true })).toThrow();
  });

  it("converts successfully (non-strict) and surfaces the warning", () => {
    const result = convertGedcom(withOrphan, { from: "5.5.1", to: "7.0.18" });
    expect(result.output).toContain("1 NAME Ada /Lovelace/");
    expect(result.diagnostics.some((d) => d.code === "MALFORMED_LINE_RECOVERED")).toBe(true);
  });
});
