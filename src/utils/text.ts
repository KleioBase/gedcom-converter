import { decodeAnsel } from "./ansel.js";

type ByteEncoding = "utf-8" | "utf-16le" | "utf-16be" | "ansel";

// The `1 CHAR` line always lives in HEAD but can sit several KB in when the
// header carries a long SOUR/NOTE block, so sniff a generous leading window.
const CHARSET_SNIFF_LIMIT = 65536;

/** Latin-1 view of the leading bytes, used to sniff the ASCII `1 CHAR …` line. */
function asciiPreview(bytes: Uint8Array, limit = CHARSET_SNIFF_LIMIT): string {
  const slice = bytes.subarray(0, Math.min(bytes.length, limit));
  return new TextDecoder("latin1").decode(slice);
}

/**
 * Determine the byte encoding of a GEDCOM stream. GEDCOM 7 is always UTF-8, but
 * 5.5/5.5.1 streams may be ANSEL (the pre-7.0 default) or UTF-16 ("UNICODE").
 * Detection precedence: a byte-order mark, then the declared `1 CHAR` value,
 * then a NUL-byte heuristic for BOM-less UTF-16, finally UTF-8.
 */
function detectByteEncoding(bytes: Uint8Array): ByteEncoding {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return "utf-16le";
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return "utf-16be";
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return "utf-8";
  }

  const charset = /\b1 CHAR (\w+)/.exec(asciiPreview(bytes))?.[1]?.toUpperCase();
  if (charset === "ANSEL") {
    return "ansel";
  }
  if (charset === "UTF-8" || charset === "UTF8" || charset === "ASCII") {
    return "utf-8";
  }
  if (charset === "UNICODE") {
    // 5.5.1 "UNICODE" means UTF-16. Without a BOM, infer endianness from where
    // the NUL bytes of the ASCII header fall.
    return nulBytesAtOddOffsets(bytes) ? "utf-16le" : "utf-16be";
  }

  // BOM-less UTF-16 with no recognisable CHAR sniff still produces interleaved
  // NULs in the ASCII header; fall back to UTF-8 otherwise.
  if (looksLikeUtf16(bytes)) {
    return nulBytesAtOddOffsets(bytes) ? "utf-16le" : "utf-16be";
  }

  return "utf-8";
}

function looksLikeUtf16(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 64));
  let nulCount = 0;
  for (const byte of sample) {
    if (byte === 0x00) {
      nulCount += 1;
    }
  }
  return nulCount >= sample.length / 4;
}

function nulBytesAtOddOffsets(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 64));
  let odd = 0;
  let even = 0;
  for (let index = 0; index < sample.length; index += 1) {
    if (sample[index] === 0x00) {
      if (index % 2 === 0) {
        even += 1;
      } else {
        odd += 1;
      }
    }
  }
  return odd >= even;
}

function decodeBytes(bytes: Uint8Array): string {
  switch (detectByteEncoding(bytes)) {
    case "ansel":
      return decodeAnsel(bytes);
    case "utf-16le":
      return new TextDecoder("utf-16le").decode(bytes);
    case "utf-16be":
      return new TextDecoder("utf-16be").decode(bytes);
    default:
      return new TextDecoder("utf-8").decode(bytes);
  }
}

export function decodeInput(input: string | Uint8Array): string {
  if (typeof input === "string") {
    return input.replace(/^\uFEFF/, "");
  }

  return decodeBytes(input).replace(/^\uFEFF/, "");
}
