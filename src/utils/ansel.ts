// ANSEL (ANSI/NISO Z39.47) decoding for legacy GEDCOM 5.5/5.5.1 byte streams.
//
// GEDCOM versions before 7.0 defaulted to the ANSEL character set, a superset of
// ASCII used by US library systems (it is the GR half of MARC-8). GEDCOM 7 only
// uses UTF-8, so to up-convert a real ANSEL file we must first decode its bytes.
//
// ANSEL has two relevant ranges above 0x7F:
//   - 0xA1–0xCF: spacing graphic characters (Ł, Ø, ©, £, …).
//   - 0xE0–0xFE: combining diacritical marks. Unlike Unicode, an ANSEL diacritic
//     *precedes* the base letter it modifies, and several may stack before a
//     single base. We buffer a run of marks, then emit base + marks and rely on
//     NFC normalisation to compose precomposed forms (e + ́  → é).
//
// Reference: GEDCOM 5.5.1 specification, Annex "ANSEL Character Set", and the
// Library of Congress MARC-8 to Unicode mapping.

/** Spacing (non-combining) graphic characters, 0xA1–0xCF. */
const ANSEL_GRAPHIC: Record<number, string> = {
  0xa1: "Ł", // Ł  capital L with stroke
  0xa2: "Ø", // Ø  capital O with stroke
  0xa3: "Đ", // Đ  capital D with stroke
  0xa4: "Þ", // Þ  capital thorn
  0xa5: "Æ", // Æ  capital AE
  0xa6: "Œ", // Œ  capital ligature OE
  0xa7: "ʹ", // ʹ  modifier prime (soft sign)
  0xa8: "·", // ·  middle dot
  0xa9: "♭", // ♭  music flat sign
  0xaa: "®", // ®  registered sign
  0xab: "±", // ±  plus-minus sign
  0xac: "Ơ", // Ơ  capital O with horn
  0xad: "Ư", // Ư  capital U with horn
  0xae: "ʼ", // ʼ  modifier right half ring (alif)
  0xb0: "ʻ", // ʻ  modifier left half ring (ayn)
  0xb1: "ł", // ł  small l with stroke
  0xb2: "ø", // ø  small o with stroke
  0xb3: "đ", // đ  small d with stroke
  0xb4: "þ", // þ  small thorn
  0xb5: "æ", // æ  small ae
  0xb6: "œ", // œ  small ligature oe
  0xb7: "ʺ", // ʺ  modifier double prime (hard sign)
  0xb8: "ı", // ı  small dotless i
  0xb9: "£", // £  pound sign
  0xba: "ð", // ð  small eth
  0xbc: "ơ", // ơ  small o with horn
  0xbd: "ư", // ư  small u with horn
  0xc0: "°", // °  degree sign
  0xc1: "ℓ", // ℓ  script small l
  0xc2: "℗", // ℗  sound recording copyright
  0xc3: "©", // ©  copyright sign
  0xc4: "♯", // ♯  music sharp sign
  0xc5: "¿", // ¿  inverted question mark
  0xc6: "¡", // ¡  inverted exclamation mark
  0xc7: "ß", // ß  small sharp s (GEDCOM extension)
  0xc8: "€", // €  euro sign (GEDCOM 5.5.1 extension)
  0xcd: "e", // e  (MARC-8 0xCD is unused in GEDCOM; map to plain e defensively)
  0xce: "o", // o
  0xcf: "ß" // ß (alternate)
};

/** Combining diacritical marks, 0xE0–0xFE. Each precedes its base in ANSEL. */
const ANSEL_COMBINING: Record<number, string> = {
  0xe0: "̉", // hook above (pseudo question mark)
  0xe1: "̀", // grave accent
  0xe2: "́", // acute accent
  0xe3: "̂", // circumflex
  0xe4: "̃", // tilde
  0xe5: "̄", // macron
  0xe6: "̆", // breve
  0xe7: "̇", // dot above
  0xe8: "̈", // dieresis (umlaut)
  0xe9: "̌", // caron (háček)
  0xea: "̊", // ring above
  0xeb: "︠", // ligature left half
  0xec: "︡", // ligature right half
  0xed: "̕", // comma above right
  0xee: "̋", // double acute accent
  0xef: "̐", // candrabindu
  0xf0: "̧", // cedilla
  0xf1: "̨", // ogonek (right hook)
  0xf2: "̣", // dot below
  0xf3: "̤", // double dot below
  0xf4: "̥", // ring below
  0xf5: "̳", // double low line
  0xf6: "̲", // line below
  0xf7: "̦", // comma below
  0xf8: "̜", // left half ring below
  0xf9: "̮", // breve below
  0xfa: "︢", // double tilde left half
  0xfb: "︣", // double tilde right half
  0xfe: "̓" // comma above
};

/**
 * Decode an ANSEL-encoded byte stream into an NFC-normalised JavaScript string.
 * Bytes 0x00–0x7F pass through as ASCII. Unmapped bytes ≥ 0x80 become U+FFFD.
 */
export function decodeAnsel(bytes: Uint8Array): string {
  let result = "";
  let pendingMarks = "";

  const flushMarks = (base: string): void => {
    result += base + pendingMarks;
    pendingMarks = "";
  };

  for (const byte of bytes) {
    if (byte < 0x80) {
      // A run of combining marks must attach to the following base character.
      flushMarks(String.fromCharCode(byte));
      continue;
    }

    const combining = ANSEL_COMBINING[byte];
    if (combining !== undefined) {
      // Unicode orders marks after the base; ANSEL lists the outermost mark
      // first, so prepend to keep innermost-nearest-base ordering after NFC.
      pendingMarks = combining + pendingMarks;
      continue;
    }

    const graphic = ANSEL_GRAPHIC[byte] ?? "�";
    flushMarks(graphic);
  }

  // Trailing diacritics with no base (malformed) are still preserved.
  if (pendingMarks.length > 0) {
    result += pendingMarks;
  }

  return result.normalize("NFC");
}
