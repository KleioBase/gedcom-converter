import { describe, expect, it } from "vitest";
import { convertGedcom, parseGedcom } from "../src/index.js";
import { SYNTHETIC_TAG_URI_BASE } from "../src/mappings/schema.js";

// SCHMA extension-declaration round-trip.

function doc551(body: string): string {
  return `0 HEAD\n1 SOUR X\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n${body}\n0 TRLR\n`;
}

function v7WithSchema(body: string): string {
  return `0 HEAD\n1 GEDC\n2 VERS 7.0.18\n1 SCHMA\n2 TAG _CUSTOM https://example.com/custom\n${body}\n0 TRLR\n`;
}

function schemaLines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /(SCHMA|TAG)/.test(line) && !line.includes("VERS"));
}

describe("5.5.1 _TAG → v7 SCHMA with a URI", () => {
  it("declares every custom tag with a synthetic URI (not a bare tag)", () => {
    const result = convertGedcom(doc551("0 @I1@ INDI\n1 _MILT Army service"), { from: "5.5.1", to: "7.0.18" });
    expect(result.output).toContain(`2 TAG _MILT ${SYNTHETIC_TAG_URI_BASE}_MILT`);
    // Regression: a TAG must carry a URI, never `2 TAG _MILT` alone.
    expect(result.output).not.toMatch(/\n2 TAG _MILT\n/);
    expect(result.diagnostics.some((d) => d.code === "SCHMA_TAG_SYNTHESIZED")).toBe(true);
    expect(() => parseGedcom(result.output, { version: "7.0.18" })).not.toThrow();
  });
});

describe("v7 SCHMA → 5.5.1 → v7 round-trip", () => {
  const v7 = v7WithSchema("0 @I1@ INDI\n1 _CUSTOM hello");

  it("preserves the SCHMA as a _SCHMA HEAD block in 5.5.1", () => {
    const down = convertGedcom(v7, { from: "7.0.18", to: "5.5.1" });
    expect(schemaLines(down.output)).toContain("1 _SCHMA");
    expect(schemaLines(down.output)).toContain("2 _TAG _CUSTOM https://example.com/custom");
    expect(down.output).toContain("1 _CUSTOM hello");
    expect(() => parseGedcom(down.output, { version: "5.5.1" })).not.toThrow();
  });

  it("retains both the SCHMA URI and the _CUSTOM data after a full round-trip", () => {
    const down = convertGedcom(v7, { from: "7.0.18", to: "5.5.1" });
    const back = convertGedcom(down.output, { from: "5.5.1", to: "7.0.18" });
    // The real (documented) URI survives — it is not replaced by a synthetic one.
    expect(back.output).toContain("2 TAG _CUSTOM https://example.com/custom");
    expect(back.output).not.toContain(`2 TAG _CUSTOM ${SYNTHETIC_TAG_URI_BASE}`);
    expect(back.output).toContain("1 _CUSTOM hello");
    expect(() => parseGedcom(back.output, { version: "7.0.18" })).not.toThrow();
  });

  it("does not declare the _SCHMA / _TAG mechanism tags as data extensions", () => {
    const down = convertGedcom(v7, { from: "7.0.18", to: "5.5.1" });
    const back = convertGedcom(down.output, { from: "5.5.1", to: "7.0.18" });
    expect(back.output).not.toMatch(/2 TAG _SCHMA\b/);
    expect(back.output).not.toMatch(/2 TAG _TAG\b/);
  });
});
