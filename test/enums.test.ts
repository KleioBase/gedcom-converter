import { describe, expect, it } from "vitest";
import {
  ADOP,
  EVEN,
  EVENATTR,
  FAMC_STAT,
  GEDCOM7_ENUM_SETS,
  MEDI,
  NAME_TYPE,
  NAME_TYPE_ALIASES,
  ORD_STAT,
  OTHER_BEARING_SETS,
  PEDI,
  QUAY,
  RESN,
  ROLE,
  ROLE_TEXT_ALIASES,
  SEX,
  enumOrPhrase,
  normalizeRoleToken
} from "../src/enums/index.js";
import { convertGedcom } from "../src/index.js";

function members(set: ReadonlySet<string>): string[] {
  return [...set].sort();
}

/** Wrap GEDCOM record lines in a minimal, version-stamped document. */
function doc(version: "5.5.1" | "7.0.18", body: string): string {
  const gedc =
    version === "5.5.1" ? "1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8" : "1 GEDC\n2 VERS 7.0.18\n1 CHAR UTF-8";
  return `0 HEAD\n1 SOUR KleioBase\n${gedc}\n${body}\n0 TRLR\n`;
}

function up(body: string) {
  return convertGedcom(doc("5.5.1", body), { from: "5.5.1", to: "7.0.18" });
}

function roundTrip(body: string) {
  const upped = up(body);
  return convertGedcom(upped.output, { from: "7.0.18", to: "5.5.1" });
}

describe("GEDCOM 7 enum sets module", () => {
  it("codifies all 12 enumeration sets from spec §3.4", () => {
    // 11 closed sets in the registry; EVEN is open-ended (null).
    expect(Object.keys(GEDCOM7_ENUM_SETS).sort()).toEqual(
      ["ADOP", "EVENATTR", "FAMC-STAT", "MEDI", "NAME-TYPE", "PEDI", "QUAY", "RESN", "ROLE", "SEX", "ord-STAT"].sort()
    );
    expect(EVEN).toBeNull();
  });

  it("exposes the exact spec value set for each enumeration", () => {
    expect(members(ADOP)).toEqual(["BOTH", "HUSB", "WIFE"]);
    expect(members(EVENATTR)).toEqual(["CENS", "EVEN", "FACT", "NCHI", "RESI"]);
    expect(members(MEDI)).toEqual(
      [
        "AUDIO",
        "BOOK",
        "CARD",
        "ELECTRONIC",
        "FICHE",
        "FILM",
        "MAGAZINE",
        "MANUSCRIPT",
        "MAP",
        "NEWSPAPER",
        "OTHER",
        "PHOTO",
        "TOMBSTONE",
        "VIDEO"
      ].sort()
    );
    expect(members(PEDI)).toEqual(["ADOPTED", "BIRTH", "FOSTER", "OTHER", "SEALING"]);
    expect(members(QUAY)).toEqual(["0", "1", "2", "3"]);
    expect(members(RESN)).toEqual(["CONFIDENTIAL", "LOCKED", "PRIVACY"]);
    expect(members(ROLE)).toEqual(
      ["CHIL", "CLERGY", "FATH", "FRIEND", "GODP", "HUSB", "MOTH", "MULTIPLE", "NGHBR", "OFFICIATOR", "OTHER", "PARENT", "SPOU", "WIFE", "WITN"].sort()
    );
    expect(members(SEX)).toEqual(["F", "M", "U", "X"]);
    expect(members(FAMC_STAT)).toEqual(["CHALLENGED", "DISPROVEN", "PROVEN"]);
    expect(members(ORD_STAT)).toEqual(
      ["BIC", "CANCELED", "CHILD", "COMPLETED", "DNS", "DNS_CAN", "EXCLUDED", "INFANT", "PRE_1970", "STILLBORN", "SUBMITTED", "UNCLEARED"].sort()
    );
    expect(members(NAME_TYPE)).toEqual(["AKA", "BIRTH", "IMMIGRANT", "MAIDEN", "MARRIED", "OTHER", "PROFESSIONAL"].sort());
  });

  it("marks exactly the OTHER-bearing sets", () => {
    for (const set of [MEDI, PEDI, ROLE, NAME_TYPE]) {
      expect(OTHER_BEARING_SETS.has(set)).toBe(true);
      expect(set.has("OTHER")).toBe(true);
    }
    for (const set of [ADOP, QUAY, RESN, SEX, FAMC_STAT, ORD_STAT, EVENATTR]) {
      expect(OTHER_BEARING_SETS.has(set)).toBe(false);
      expect(set.has("OTHER")).toBe(false);
    }
  });
});

describe("enumOrPhrase", () => {
  it("returns the matched enum for an exact member", () => {
    expect(enumOrPhrase("BOOK", MEDI)).toEqual({ enum: "BOOK", matched: true });
  });

  it("normalises casing and separators before matching", () => {
    expect(enumOrPhrase("birth", PEDI)).toEqual({ enum: "BIRTH", matched: true });
    expect(enumOrPhrase("dns can", ORD_STAT)).toEqual({ enum: "DNS_CAN", matched: true });
  });

  it("resolves aliases before the set itself", () => {
    expect(enumOrPhrase("Profession", NAME_TYPE, { aliases: NAME_TYPE_ALIASES })).toEqual({
      enum: "PROFESSIONAL",
      matched: true
    });
    expect(enumOrPhrase("God Parent", ROLE, { aliases: ROLE_TEXT_ALIASES, normalize: normalizeRoleToken })).toEqual({
      enum: "GODP",
      matched: true
    });
  });

  it("falls back to OTHER + the original phrase when unmatched", () => {
    expect(enumOrPhrase("hand-drawn map", MEDI)).toEqual({
      enum: "OTHER",
      phrase: "hand-drawn map",
      matched: false
    });
  });

  it("supports a non-OTHER fallback for sets without OTHER", () => {
    const result = enumOrPhrase("notarised", ORD_STAT);
    expect(result.matched).toBe(false);
    expect(result.enum).toBe("OTHER"); // caller for ord-STAT inspects `matched` and ignores this default
  });
});

describe("enum round-trips (5.5.1 → v7 → 5.5.1)", () => {
  it("NAME-TYPE: aka → AKA → aka", () => {
    const body = "0 @I1@ INDI\n1 NAME John /Doe/\n2 TYPE aka";
    expect(up(body).output).toContain("2 TYPE AKA");
    expect(roundTrip(body).output).toContain("2 TYPE aka");
  });

  it("PEDI: birth → BIRTH → birth", () => {
    const body = "0 @I1@ INDI\n1 FAMC @F1@\n2 PEDI birth\n0 @F1@ FAM\n1 CHIL @I1@";
    expect(up(body).output).toContain("2 PEDI BIRTH");
    expect(roundTrip(body).output).toContain("2 PEDI birth");
  });

  it("ord-STAT: COMPLETED round-trips", () => {
    const body = "0 @I1@ INDI\n1 BAPL\n2 STAT COMPLETED\n3 DATE 27 MAR 2022";
    expect(up(body).output).toContain("2 STAT COMPLETED");
    expect(roundTrip(body).output).toContain("2 STAT COMPLETED");
  });

  it("QUAY: 3 round-trips inside a source citation", () => {
    const body = "0 @I1@ INDI\n1 BIRT\n2 SOUR @S1@\n3 QUAY 3\n0 @S1@ SOUR\n1 TITL Birth record";
    expect(up(body).output).toContain("3 QUAY 3");
    expect(roundTrip(body).output).toContain("3 QUAY 3");
  });

  it("SEX: M round-trips and v7-only X down-converts to U", () => {
    expect(up("0 @I1@ INDI\n1 SEX M").output).toContain("1 SEX M");
    expect(roundTrip("0 @I1@ INDI\n1 SEX M").output).toContain("1 SEX M");
    // X is v7-only; the down-conversion folds it to U (existing compatibility rule).
    const down = convertGedcom(doc("7.0.18", "0 @I1@ INDI\n1 SEX X"), { from: "7.0.18", to: "5.5.1" });
    expect(down.output).toContain("1 SEX U");
  });

  it("ADOP: BOTH round-trips on an adoption family link", () => {
    const body = "0 @I1@ INDI\n1 ADOP\n2 FAMC @F1@\n3 ADOP BOTH\n0 @F1@ FAM\n1 CHIL @I1@";
    expect(up(body).output).toContain("3 ADOP BOTH");
    expect(roundTrip(body).output).toContain("3 ADOP BOTH");
  });

  it("MEDI: book → BOOK on a repository citation", () => {
    const body = "0 @S1@ SOUR\n1 TITL Source\n1 REPO @R1@\n2 CALN 929 Smi\n3 MEDI book\n0 @R1@ REPO\n1 NAME Archive";
    expect(up(body).output).toContain("3 MEDI BOOK");
  });

  it("RESN: privacy → PRIVACY", () => {
    expect(up("0 @I1@ INDI\n1 RESN privacy").output).toContain("1 RESN PRIVACY");
  });

  it("ROLE: free-text RELA → enum and back to humanised text", () => {
    const body = "0 @I1@ INDI\n1 ASSO @I2@\n2 RELA Father\n0 @I2@ INDI\n1 NAME Dad /Doe/";
    expect(up(body).output).toContain("2 ROLE FATH");
    expect(roundTrip(body).output).toContain("2 RELA Father");
  });
});

describe("out-of-set 5.5.1 values fall back to OTHER + PHRASE with a diagnostic", () => {
  it("MEDI unknown value → OTHER + PHRASE (MEDI_PHRASE_FALLBACK)", () => {
    const result = up("0 @S1@ SOUR\n1 TITL S\n1 REPO @R1@\n2 CALN 1\n3 MEDI scroll\n0 @R1@ REPO\n1 NAME A");
    expect(result.output).toContain("3 MEDI OTHER");
    expect(result.output).toContain("4 PHRASE scroll");
    expect(result.diagnostics.some((d) => d.code === "MEDI_PHRASE_FALLBACK")).toBe(true);
  });

  it("PEDI unknown value → OTHER + PHRASE (PEDI_PHRASE_FALLBACK)", () => {
    const result = up("0 @I1@ INDI\n1 FAMC @F1@\n2 PEDI guardianship\n0 @F1@ FAM\n1 CHIL @I1@");
    expect(result.output).toContain("2 PEDI OTHER");
    expect(result.output).toContain("3 PHRASE guardianship");
    expect(result.diagnostics.some((d) => d.code === "PEDI_PHRASE_FALLBACK")).toBe(true);
  });

  it("ROLE free text outside the enum → OTHER + PHRASE (RELA_PHRASE_FALLBACK)", () => {
    const result = up("0 @I1@ INDI\n1 ASSO @I2@\n2 RELA Family lawyer\n0 @I2@ INDI\n1 NAME L /Aw/");
    expect(result.output).toContain("2 ROLE OTHER");
    expect(result.output).toContain("3 PHRASE Family lawyer");
    expect(result.diagnostics.some((d) => d.code === "RELA_PHRASE_FALLBACK")).toBe(true);
  });

  it("NAME-TYPE unknown value → OTHER + PHRASE", () => {
    const result = up("0 @I1@ INDI\n1 NAME John /Doe/\n2 TYPE nickname-at-work");
    expect(result.output).toContain("2 TYPE OTHER");
    expect(result.output).toContain("3 PHRASE nickname-at-work");
  });
});
