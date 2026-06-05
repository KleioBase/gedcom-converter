import { describe, expect, it } from "vitest";
import { convertGedcom } from "../src/index.js";

const H7 = "0 HEAD\n1 GEDC\n2 VERS 7.0.18\n";
const H551 = "0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n";
const UID = "550e8400-e29b-41d4-a716-446655440000";
// A realistic media path: longer than the obsolete 30-char 5.5.1 limit.
const LONGFILE = "https://media.example.com/photos/a-very-long-photo-reference-12345.jpg";

describe("UID is preserved as the 5.5.1 _UID extension, not flattened to a note", () => {
  it("down-converts a v7 UID to a 5.5.1 _UID", () => {
    const r = convertGedcom(`${H7}0 @I1@ INDI\n1 UID ${UID}\n0 TRLR`, { from: "7.0.18", to: "5.5.1" });
    expect(r.output).toContain(`_UID ${UID}`);
    expect(r.output).not.toMatch(/NOTE UID:/);
  });

  it("preserves _UID across a 5.5.1 -> v7 -> 5.5.1 round-trip", () => {
    const up = convertGedcom(`${H551}0 @I1@ INDI\n1 _UID ${UID}\n0 TRLR`, { from: "5.5.1", to: "7.0.18" });
    const back = convertGedcom(up.output, { from: "7.0.18", to: "5.5.1" });
    expect(back.output).toContain(`_UID ${UID}`);
  });
});

describe("multimedia FILE references are kept structured, not degraded on length", () => {
  it("keeps a long OBJE/FILE reference as a FILE through a round-trip", () => {
    const input = `${H551}0 @I1@ INDI\n1 NAME Ada /Lovelace/\n1 OBJE\n2 FILE ${LONGFILE}\n3 FORM jpg\n0 TRLR`;
    const up = convertGedcom(input, { from: "5.5.1", to: "7.0.18" });
    const back = convertGedcom(up.output, { from: "7.0.18", to: "5.5.1" });
    expect(back.output).toMatch(/\d+ FILE https:\/\/media\.example\.com/);
    expect(back.diagnostics.some((d) => d.code === "FILE_REFERENCE_DEGRADED")).toBe(false);
  });

  it("keeps a 5.5-style OBJE (FORM as a sibling of FILE) structured through a round-trip", () => {
    // MyHeritage and other tools emit the older layout where FORM is a sibling
    // of FILE under OBJE, rather than a child of FILE.
    const input = `${H551}0 @I1@ INDI\n1 OBJE\n2 FORM jpg\n2 FILE ${LONGFILE}\n0 TRLR`;
    const up = convertGedcom(input, { from: "5.5.1", to: "7.0.18" });
    const back = convertGedcom(up.output, { from: "7.0.18", to: "5.5.1" });
    expect(back.output).toMatch(/\d+ FILE https:\/\/media\.example\.com/);
    expect(back.diagnostics.some((d) => d.code === "FILE_REFERENCE_NOTED")).toBe(false);
  });

  it("round-trips non-image media formats (pdf) without losing the FILE", () => {
    const input = `${H551}0 @I1@ INDI\n1 OBJE\n2 FORM pdf\n2 FILE https://media.example.com/docs/a-scanned-record.pdf\n0 TRLR`;
    const up = convertGedcom(input, { from: "5.5.1", to: "7.0.18" });
    const back = convertGedcom(up.output, { from: "7.0.18", to: "5.5.1" });
    expect(back.output).toMatch(/\d+ FILE https:\/\/media\.example\.com/);
    expect(back.output).toMatch(/\d+ FORM pdf/);
    expect(back.diagnostics.some((d) => d.code === "FILE_REFERENCE_NOTED")).toBe(false);
  });

  it("does not demote a long FILE to _FILE on direct v7 -> 5.5.1 down-conversion", () => {
    const input = `${H7}0 @O1@ OBJE\n1 FILE ${LONGFILE}\n2 FORM image/jpeg\n0 TRLR`;
    const r = convertGedcom(input, { from: "7.0.18", to: "5.5.1" });
    expect(r.output).toMatch(/\d+ FILE https:\/\/media\.example\.com/);
    expect(r.output).not.toMatch(/_FILE/);
  });
});
