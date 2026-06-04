import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { convertGedcom, parseGedcom } from "../src/index.js";
import { decodeInput } from "../src/utils/text.js";
import { decodeAnsel } from "../src/utils/ansel.js";

/** Wrap record lines in a minimal, version-stamped document. */
function doc(version: "5.5.1" | "7.0.18", body: string): string {
  const gedc =
    version === "5.5.1"
      ? "1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8"
      : "1 GEDC\n2 VERS 7.0.18\n1 CHAR UTF-8";
  return `0 HEAD\n1 SOUR KleioBase\n${gedc}\n${body}\n0 TRLR\n`;
}

function up(body: string) {
  return convertGedcom(doc("5.5.1", body), { from: "5.5.1", to: "7.0.18" });
}

function roundTrip(body: string) {
  return convertGedcom(up(body).output, { from: "7.0.18", to: "5.5.1" });
}

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

describe("5.5.1 → v7 date phrases (§2.4)", () => {
  it("splits an interpreted INT date into DATE payload + PHRASE", () => {
    const result = up("0 @I1@ INDI\n1 DEAT\n2 DATE INT 1900 (about then)");
    expect(result.output).toContain("2 DATE 1900");
    expect(result.output).toContain("3 PHRASE about then");
    expect(result.output).not.toContain("INT 1900");
    expect(result.diagnostics.some((d) => d.code === "DATE_INT_CONVERTED")).toBe(true);
  });

  it("moves a bare (phrase) date into a PHRASE with an empty DATE payload", () => {
    const result = up("0 @I1@ INDI\n1 DEAT\n2 DATE (sometime)");
    expect(result.output).toMatch(/\n2 DATE\n3 PHRASE sometime/);
    expect(result.diagnostics.some((d) => d.code === "DATE_PHRASE_EXTRACTED")).toBe(true);
  });

  it("emits valid GEDCOM 7 (no INT keyword survives)", () => {
    const result = up("0 @I1@ INDI\n1 DEAT\n2 DATE INT 1900 (about then)");
    expect(() => parseGedcom(result.output, { version: "7.0.18" })).not.toThrow();
  });

  it("round-trips INT and bare-phrase dates back to 5.5.1 forms", () => {
    expect(roundTrip("0 @I1@ INDI\n1 DEAT\n2 DATE INT 1900 (about then)").output).toContain(
      "2 DATE INT 1900 (about then)"
    );
    expect(roundTrip("0 @I1@ INDI\n1 DEAT\n2 DATE (sometime)").output).toContain("2 DATE (sometime)");
  });

  it("leaves an ordinary date untouched", () => {
    const result = up("0 @I1@ INDI\n1 DEAT\n2 DATE 3 MAR 1900");
    expect(result.output).toContain("2 DATE 3 MAR 1900");
    expect(result.output).not.toContain("PHRASE");
  });
});

describe("5.5.1 → v7 phonetic/romanized name & place variations", () => {
  it("converts NAME.FONE to a NAME.TRAN with a language tag", () => {
    const result = up("0 @I1@ INDI\n1 NAME Yamada /Tarou/\n2 FONE Yamada /Tarou/\n3 TYPE kana");
    expect(result.output).toContain("2 TRAN Yamada /Tarou/");
    expect(result.output).toContain("3 LANG und");
    expect(result.output).not.toMatch(/\n2 FONE/);
    expect(result.diagnostics.some((d) => d.code === "FONE_TO_TRAN")).toBe(true);
  });

  it("converts PLAC.ROMN to a PLAC.TRAN with a language tag", () => {
    const result = up("0 @I1@ INDI\n1 BIRT\n2 PLAC 東京\n3 ROMN Toukyou\n4 TYPE romaji");
    expect(result.output).toContain("3 TRAN Toukyou");
    expect(result.output).toContain("4 LANG und");
    expect(result.output).not.toMatch(/\n3 ROMN/);
    expect(result.diagnostics.some((d) => d.code === "ROMN_TO_TRAN")).toBe(true);
  });

  it("produces valid GEDCOM 7 for FONE/ROMN input", () => {
    const result = up("0 @I1@ INDI\n1 NAME Y /T/\n2 FONE Y /T/\n3 TYPE kana\n2 ROMN Y /T/\n3 TYPE pinyin");
    expect(() => parseGedcom(result.output, { version: "7.0.18" })).not.toThrow();
  });
});

describe("5.5.1 → v7 identifiers", () => {
  it("maps AFN to an EXID and recovers it on the way back", () => {
    const result = up("0 @I1@ INDI\n1 AFN 1234-567");
    expect(result.output).toContain("1 EXID 1234-567");
    expect(result.output).toMatch(/2 TYPE \S+\/AFN/);
    expect(result.output).not.toMatch(/\n1 AFN/);
    expect(result.diagnostics.some((d) => d.code === "AFN_TO_EXID")).toBe(true);
    expect(roundTrip("0 @I1@ INDI\n1 AFN 1234-567").output).toContain("1 AFN 1234-567");
  });

  it("promotes the 5.5.1 _UID extension to the standard v7 UID tag", () => {
    const result = up("0 @I1@ INDI\n1 _UID 550e8400-e29b-41d4-a716-446655440000");
    expect(result.output).toContain("1 UID 550e8400-e29b-41d4-a716-446655440000");
    expect(result.output).not.toContain("1 _UID");
    expect(result.diagnostics.some((d) => d.code === "UID_PROMOTED")).toBe(true);
    // _UID no longer needs a SCHMA declaration once it is a standard tag.
    expect(result.output).not.toMatch(/2 TAG _UID/);
  });
});

describe("ANSEL decoding", () => {
  it("decodes combining diacritics (mark precedes base) into NFC characters", () => {
    // J o s <0xE2 acute> e  →  José ; M <0xE8 dieresis> u …  →  Mü…
    const bytes = Uint8Array.from([...ascii("Jos"), 0xe2, ...ascii("e M"), 0xe8, ...ascii("uller")]);
    expect(decodeAnsel(bytes)).toBe("José Müller");
  });

  it("decodes ANSEL spacing graphics (Ł, ©, £)", () => {
    const bytes = Uint8Array.from([0xa1, ...ascii("odz "), 0xc3, ...ascii(" "), 0xb9]);
    expect(decodeAnsel(bytes)).toBe("Łodz © £");
  });

  it("decodes a real ANSEL-encoded 5.5 stream end-to-end", () => {
    const bytes = readFileSync(resolve(process.cwd(), "fixtures/official/gedcom551/TGC551LF.ged"));
    const decoded = decodeInput(bytes);
    // The copyright sign (ANSEL 0xC3) must decode, not become U+FFFD.
    expect(decoded).toContain("© 1997 by H. Eichmann");
    expect(decoded).not.toContain("� 1997");

    const upgraded = convertGedcom(bytes, { from: "5.5", to: "7.0.18" });
    expect(upgraded.output).toContain("© 1997 by H. Eichmann");
    expect(() => parseGedcom(upgraded.output, { version: "7.0.18" })).not.toThrow();
  });

  it("up-converts a synthetic ANSEL individual to UTF-8 GEDCOM 7", () => {
    const head = "0 HEAD\n1 SOUR X\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR ANSEL\n";
    const bytes = Uint8Array.from([
      ...ascii(head),
      ...ascii("0 @I1@ INDI\n1 NAME Jos"),
      0xe2,
      ...ascii("e /M"),
      0xe8,
      ...ascii("uller/\n0 TRLR\n")
    ]);
    const result = convertGedcom(bytes, { from: "5.5.1", to: "7.0.18" });
    expect(result.output).toContain("1 NAME José /Müller/");
  });
});

describe("UTF-16 decoding", () => {
  it("decodes a UTF-16LE BOM stream", () => {
    const text = "0 HEAD\n1 CHAR UNICODE\n0 TRLR\n";
    const u16 = new Uint8Array(2 + text.length * 2);
    u16[0] = 0xff;
    u16[1] = 0xfe;
    for (let i = 0; i < text.length; i += 1) {
      u16[2 + i * 2] = text.charCodeAt(i) & 0xff;
      u16[2 + i * 2 + 1] = (text.charCodeAt(i) >> 8) & 0xff;
    }
    expect(decodeInput(u16)).toBe(text);
  });
});
