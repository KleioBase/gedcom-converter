import { ConversionError } from "../errors/index.js";
import { sanitizeGedcom551Document } from "../gedcom551/compatibility.js";
import { toIntermediateDocument } from "../ir/types.js";
import { mapGedcom551DocumentToV7 } from "../mappings/551-to-v7.js";
import { mapGedcom7DocumentTo551 } from "../mappings/v7-to-551.js";
import type { ParsedDocument, SupportedVersion } from "../types.js";

export interface RetargetOptions {
  /**
   * Run the 5.5.1 compatibility sanitizer even when the document is already
   * 5.5.1. Conversion does; plain serialization does not, because the sanitizer
   * is lossy (it rewrites `@`-prefixed continuation lines) and serializing a
   * 5.5.1 document must round-trip unchanged.
   */
  sanitizeSameVersion?: boolean;
}

/**
 * Bring a parsed document to `target`, running the version mapper unless it is
 * already there. Shared by `convertGedcom` and `stringifyGedcom` so the two
 * cannot drift: serializing cross-version without this keeps the source
 * version's enum casing and version-only tags. Does not mutate `document`.
 */
export function retargetDocument(
  document: ParsedDocument,
  target: SupportedVersion,
  options: RetargetOptions = {}
): ParsedDocument {
  const intermediate = toIntermediateDocument(document);

  let output: ParsedDocument;

  if (intermediate.version === target) {
    output = intermediate;
  } else if (intermediate.version === "5.5" && target === "5.5.1") {
    // 5.5 is read-only and normalised to 5.5.1 on parse, so only the stamp moves.
    output = {
      ...intermediate,
      version: "5.5.1",
      header: {
        ...intermediate.header,
        gedcomVersion: "5.5.1"
      }
    };
  } else if (intermediate.version === "5.5" && target === "7.0.18") {
    output = mapGedcom551DocumentToV7({
      ...intermediate,
      version: "5.5.1",
      header: {
        ...intermediate.header,
        gedcomVersion: "5.5.1"
      }
    });
  } else if (intermediate.version === "7.0.18" && target === "5.5.1") {
    output = mapGedcom7DocumentTo551(intermediate);
  } else if (intermediate.version === "5.5.1" && target === "7.0.18") {
    output = mapGedcom551DocumentToV7(intermediate);
  } else {
    throw new ConversionError(`Conversion from ${intermediate.version} to ${target} is not implemented yet.`);
  }

  if (target === "5.5.1" && (intermediate.version !== target || options.sanitizeSameVersion)) {
    output = sanitizeGedcom551Document(output);
  }

  return output;
}
