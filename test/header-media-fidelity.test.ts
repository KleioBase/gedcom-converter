import { describe, expect, it } from "vitest";
import { convertGedcom } from "../src/index.js";

const H551 = "0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n";

describe("multimedia is preserved without inventing a media TYPE", () => {
  it("does not add a TYPE to a FORM that had no MEDI (no guessing)", () => {
    const v7 = `0 HEAD\n1 GEDC\n2 VERS 7.0.18\n0 @O1@ OBJE\n1 FILE media/p.jpg\n2 FORM image/jpeg\n0 TRLR`;
    const result = convertGedcom(v7, { from: "7.0.18", to: "5.5.1" });
    expect(result.output).toContain("2 FORM jpg");
    expect(result.output).not.toMatch(/TYPE PHOTO/);
    expect(result.output).not.toMatch(/\d+ TYPE /);
  });

  it("keeps a real MEDI as the FORM TYPE", () => {
    const v7 = `0 HEAD\n1 GEDC\n2 VERS 7.0.18\n0 @O1@ OBJE\n1 FILE media/p.jpg\n2 FORM image/jpeg\n3 MEDI PHOTO\n0 TRLR`;
    const result = convertGedcom(v7, { from: "7.0.18", to: "5.5.1" });
    expect(result.output).toContain("2 FORM jpg");
    expect(result.output).toContain("3 TYPE PHOTO");
  });

  it("preserves FORM children (standard TYPE and vendor extensions) through a round-trip", () => {
    const input =
      `${H551}0 @O1@ OBJE\n1 FILE\n2 FORM jpg\n3 TYPE image\n3 _MTYPE portrait\n` +
      `3 _SIZE 7038\n3 _WDTH 215\n3 _HGHT 319\n2 TITL Murry and Bea\n0 TRLR`;
    const up = convertGedcom(input, { from: "5.5.1", to: "7.0.18" });
    const back = convertGedcom(up.output, { from: "7.0.18", to: "5.5.1" });
    expect(back.output).toMatch(/\n2 FORM jpg/);
    expect(back.output).toMatch(/\n3 TYPE image/);
    expect(back.output).toMatch(/\n3 _MTYPE portrait/);
    expect(back.output).toMatch(/\n3 _SIZE 7038/);
    expect(back.output).toMatch(/\n3 _WDTH 215/);
    expect(back.output).toMatch(/\n3 _HGHT 319/);
    // No invented media TYPE beyond the one the source carried.
    expect((back.output.match(/\n3 TYPE /g) ?? []).length).toBe(1);
  });

  it("round-trips an inline OBJE with FORM under FILE and TITL under OBJE", () => {
    const input = `${H551}0 @I1@ INDI\n1 OBJE\n2 FORM jpg\n2 FILE https://example.com/p.jpg\n2 TITL Photo\n0 TRLR`;
    const up = convertGedcom(input, { from: "5.5.1", to: "7.0.18" });
    const back = convertGedcom(up.output, { from: "7.0.18", to: "5.5.1" });
    // For an inline (embedded) OBJE, 5.5.1 places FORM under FILE but TITL as a
    // direct child of OBJE (sibling of FILE) — not under FILE.
    expect(back.output).toMatch(/\n2 FILE https:\/\/example\.com/);
    expect(back.output).toMatch(/\n3 FORM jpg/);
    expect(back.output).not.toMatch(/\n2 FORM jpg/);
    expect(back.output).toMatch(/\n2 TITL Photo/);
    expect(back.output).not.toMatch(/\n3 TITL Photo/);
    expect(back.output).not.toMatch(/TYPE PHOTO/);
    expect(back.output).not.toMatch(/NOTE Object title:/);
  });

  it("promotes an inline OBJE to a v7 multimedia record referenced by a pointer", () => {
    const input = `${H551}0 @I1@ INDI\n1 OBJE\n2 FORM jpg\n2 FILE photo.jpg\n2 TITL Photo\n0 TRLR`;
    const up = convertGedcom(input, { from: "5.5.1", to: "7.0.18" });
    // The INDI now carries a pointer, and a top-level OBJE record holds the media.
    expect(up.output).toMatch(/0 @I1@ INDI\n1 OBJE @[^@]+@/);
    expect(up.output).toMatch(/\n0 @[^@]+@ OBJE\n1 FILE photo\.jpg/);
    expect(up.output).not.toMatch(/1 OBJE\n2 FILE/);
  });

  it("round-trips an inline OBJE through v7 records back to embedded 5.5.1", () => {
    const input = `${H551}0 @I1@ INDI\n1 OBJE\n2 FORM jpg\n2 FILE photo.jpg\n2 TITL Photo\n0 TRLR`;
    const up = convertGedcom(input, { from: "5.5.1", to: "7.0.18" });
    const back = convertGedcom(up.output, { from: "7.0.18", to: "5.5.1" });
    // Back to the original embedded layout: no synthesised OBJE record remains.
    expect(back.output).not.toMatch(/\n0 @[^@]+@ OBJE/);
    expect(back.output).toMatch(/\n1 OBJE\n2 FILE photo\.jpg/);
    expect(back.output).toMatch(/\n3 FORM jpg/);
    expect(back.output).toMatch(/\n2 TITL Photo/);
  });

  it("keeps a native v7 OBJE record as a record (does not re-inline) on down-conversion", () => {
    const v7 = `0 HEAD\n1 GEDC\n2 VERS 7.0.18\n0 @I1@ INDI\n1 OBJE @O1@\n0 @O1@ OBJE\n1 FILE p.jpg\n2 FORM image/jpeg\n0 TRLR`;
    const back = convertGedcom(v7, { from: "7.0.18", to: "5.5.1" });
    expect(back.output).toMatch(/\n0 @O1@ OBJE/);
    expect(back.output).toMatch(/\n1 OBJE @O1@/);
  });

  it("keeps TITL under FILE for an OBJE record (the 5.5.1 record form)", () => {
    const v7 = `0 HEAD\n1 GEDC\n2 VERS 7.0.18\n0 @O1@ OBJE\n1 FILE p.jpg\n2 FORM image/jpeg\n2 TITL Photo\n0 TRLR`;
    const back = convertGedcom(v7, { from: "7.0.18", to: "5.5.1" });
    // A multimedia *record* keeps TITL under FILE (valid 5.5.1 MULTIMEDIA_RECORD).
    expect(back.output).toMatch(/\n2 TITL Photo/);
    expect(back.output).not.toMatch(/\n1 TITL Photo/);
  });
});

describe("HEAD metadata is preserved", () => {
  it("round-trips HEAD.LANG", () => {
    const input = `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n1 LANG Hebrew\n0 @I1@ INDI\n1 NAME A /B/\n0 TRLR`;
    const up = convertGedcom(input, { from: "5.5.1", to: "7.0.18" });
    const back = convertGedcom(up.output, { from: "7.0.18", to: "5.5.1" });
    expect(back.output).toMatch(/\n1 LANG Hebrew/);
  });

  it("maps HEAD.LANG to a BCP-47 code in v7 and restores the name on down-conversion", () => {
    const input = `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n1 LANG Hebrew\n0 @I1@ INDI\n1 NAME A /B/\n0 TRLR`;
    const up = convertGedcom(input, { from: "5.5.1", to: "7.0.18" });
    expect(up.output).toMatch(/\n1 LANG he\b/);
    expect(up.output).not.toMatch(/\n1 LANG Hebrew/);
    const back = convertGedcom(up.output, { from: "7.0.18", to: "5.5.1" });
    expect(back.output).toMatch(/\n1 LANG Hebrew/);
  });

  it("preserves HEAD.FILE as a _FILE extension in v7 and restores it on down-conversion", () => {
    const input = `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n1 FILE export.ged\n0 @I1@ INDI\n1 NAME A /B/\n0 TRLR`;
    const up = convertGedcom(input, { from: "5.5.1", to: "7.0.18" });
    expect(up.output).toMatch(/\n1 _FILE export\.ged/);
    expect(up.output).not.toMatch(/\n1 FILE export\.ged/);
    expect(up.output).toMatch(/2 TAG _FILE /);
    const back = convertGedcom(up.output, { from: "7.0.18", to: "5.5.1" });
    expect(back.output).toMatch(/\n1 FILE export\.ged/);
    expect(back.output).not.toMatch(/\n1 _FILE export\.ged/);
  });

  it("round-trips a HEAD-level extension tag", () => {
    const input = `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n1 _PROJECT_GUID abc-123\n0 @I1@ INDI\n1 NAME A /B/\n0 TRLR`;
    const up = convertGedcom(input, { from: "5.5.1", to: "7.0.18" });
    const back = convertGedcom(up.output, { from: "7.0.18", to: "5.5.1" });
    expect(back.output).toMatch(/_PROJECT_GUID abc-123/);
  });

  it("preserves a nested extension subtree under HEAD.SOUR", () => {
    const input =
      `0 HEAD\n1 SOUR Ancestry.com Family Trees\n2 NAME Member Trees\n2 VERS 2025.08\n` +
      `2 _TREE My Family Tree\n3 RIN 206819316\n3 _ENV prd\n2 CORP Ancestry.com\n` +
      `1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME A /B/\n0 TRLR`;
    const up = convertGedcom(input, { from: "5.5.1", to: "7.0.18" });
    const back = convertGedcom(up.output, { from: "7.0.18", to: "5.5.1" });
    // The extension subtree and its nested children survive the down-leg verbatim.
    expect(back.output).toMatch(/\n2 _TREE My Family Tree/);
    expect(back.output).toMatch(/\n3 RIN 206819316/);
    expect(back.output).toMatch(/\n3 _ENV prd/);
    // Standard SOUR children are still present and not duplicated.
    expect(back.output).toMatch(/\n2 CORP Ancestry\.com/);
  });
});
