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

describe("5.5.1 → v7 qualified date periods", () => {
  const qualified = [
    ["FROM ABT 1920 TO ABT 1930", "FROM 1920 TO 1930"],
    ["FROM ABT 1930", "FROM 1930"],
    ["TO ABT 1930", "TO 1930"],
    ["FROM AFT 1950", "FROM 1950"],
    ["FROM BEF 1985 TO BEF 2008", "FROM 1985 TO 2008"],
    ["FROM 1916 TO BEF 1942", "FROM 1916 TO 1942"],
    ["FROM 26 SEP 1972 TO ABT 1979", "FROM 26 SEP 1972 TO 1979"]
  ];

  it.each(qualified)("strips the qualifiers from %s and keeps the wording as PHRASE", (source, period) => {
    const result = up(`0 @I1@ INDI\n1 RESI\n2 DATE ${source}`);
    expect(result.output).toContain(`2 DATE ${period}\n3 PHRASE ${source}\n`);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["QUALIFIED_DATE_PERIOD_NORMALIZED"]);
  });

  it.each(qualified)("round-trips %s back to the source 5.5.1 wording", (source) => {
    const result = roundTrip(`0 @I1@ INDI\n1 RESI\n2 DATE ${source}`);
    expect(result.output).toContain(`2 DATE ${source}\n`);
    expect(result.output).not.toContain("PHRASE");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("applies to every DATE context, not just RESI", () => {
    const result = up("0 @I1@ INDI\n1 BIRT\n2 DATE FROM ABT 1900\n1 DEAT\n2 DATE TO BEF 1990");
    expect(result.output).toContain("2 DATE FROM 1900\n3 PHRASE FROM ABT 1900\n");
    expect(result.output).toContain("2 DATE TO 1990\n3 PHRASE TO BEF 1990\n");
  });

  it("strips a qualifier ahead of a calendar keyword and restores it on the way back", () => {
    const body = "0 @I1@ INDI\n1 RESI\n2 DATE FROM EST @#DJULIAN@ 1700 TO CAL 1710";
    expect(up(body).output).toContain(
      "2 DATE FROM JULIAN 1700 TO 1710\n3 PHRASE FROM EST @#DJULIAN@ 1700 TO CAL 1710\n"
    );
    expect(roundTrip(body).output).toContain("2 DATE FROM EST @#DJULIAN@ 1700 TO CAL 1710\n");
  });

  it("leaves conformant periods and qualified non-periods untouched", () => {
    const result = up("0 @I1@ INDI\n1 RESI\n2 DATE FROM 1939 TO 1940\n1 BIRT\n2 DATE ABT 1900\n1 DEAT\n2 DATE BEF 1990");
    expect(result.output).toContain("2 DATE FROM 1939 TO 1940\n");
    expect(result.output).toContain("2 DATE ABT 1900\n");
    expect(result.output).toContain("2 DATE BEF 1990\n");
    expect(result.output).not.toContain("PHRASE");
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("5.5.1 → v7 XML-encoded DSCR", () => {
  it("rewrites the MyHeritage XML payload as readable text", () => {
    const result = up(
      "0 @I1@ INDI\n1 DSCR <DSCR><HAIR>Brown</HAIR><EYES>Brown</EYES><WEIGHT>59.9</WEIGHT><HEIGHT>182</HEIGHT></DSCR>"
    );
    expect(result.output).toContain("1 DSCR Hair: Brown, Eyes: Brown, Weight: 59.9, Height: 182\n");
    expect(result.diagnostics.map((d) => d.code)).toEqual(["DSCR_XML_PAYLOAD_NORMALIZED"]);
  });

  it("keeps unknown elements generically, decoding entities and skipping empty ones", () => {
    const result = up("0 @I1@ INDI\n1 DSCR <DSCR><BLOOD_TYPE>A &amp; B</BLOOD_TYPE><SKIN></SKIN></DSCR>");
    expect(result.output).toContain("1 DSCR Blood type: A & B\n");
  });

  it("leaves free-text DSCR untouched", () => {
    const result = up("0 @I1@ INDI\n1 DSCR Tall with brown hair");
    expect(result.output).toContain("1 DSCR Tall with brown hair\n");
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    "<DSCR><HAIR>Brown</HAIR><EYES>Brown",
    "<DSCR><HAIR>Brown</EYES></DSCR>",
    "<DSCR></DSCR>",
    "<DSCR>loose text<HAIR>Brown</HAIR></DSCR>"
  ])("keeps malformed payload %s verbatim", (payload) => {
    const result = up(`0 @I1@ INDI\n1 DSCR ${payload}`);
    expect(result.output).toContain(`1 DSCR ${payload}\n`);
    expect(result.diagnostics).toHaveLength(0);
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
