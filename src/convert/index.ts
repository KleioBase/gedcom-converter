import { ConversionError } from "../errors/index.js";
import { parseGedcom551 } from "../gedcom551/parser.js";
import { stringifyGedcom551 } from "../gedcom551/serializer.js";
import { parseGedcom7 } from "../gedcom7/parser.js";
import { stringifyGedcom7 } from "../gedcom7/serializer.js";
import { retargetDocument } from "./retarget.js";
import type { ConversionResult, ConvertOptions, ParsedDocument } from "../types.js";

function countUnsupported(document: ParsedDocument): number {
  return document.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
}

function countPreservedExtensions(document: ParsedDocument): number {
  const recordExtensions = document.records.flatMap((record) =>
    record.children.filter((child) => child.tag.startsWith("_"))
  );

  return document.extensions.length + recordExtensions.length;
}

/**
 * Convert a GEDCOM document from one version to another.
 *
 * Produces valid target-version output plus diagnostics describing any lossy or
 * preserved structures. With `options.strict`, the conversion throws if any
 * warning is emitted.
 *
 * @param input - Source GEDCOM text or bytes.
 * @param options - `from` / `to` versions and conversion flags.
 * @returns The converted `output`, `diagnostics`, and `stats`.
 * @throws {@link ConversionError} on an unsupported version pair or (in strict mode) on warnings.
 * @public
 */
export function convertGedcom(input: string | Uint8Array, options: ConvertOptions): ConversionResult {
  const sourceDocument = options.from === "7.0.18" ? parseGedcom7(input) : parseGedcom551(input);
  const outputDocument: ParsedDocument = retargetDocument(sourceDocument, options.to, {
    sanitizeSameVersion: true
  });

  if (options.strict && outputDocument.diagnostics.some((diagnostic) => diagnostic.severity === "warning")) {
    throw new ConversionError("Strict conversion failed because warnings were emitted.");
  }

  const output =
    options.to === "7.0.18" ? stringifyGedcom7(outputDocument) : stringifyGedcom551(outputDocument);

  return {
    version: options.to,
    output,
    diagnostics: outputDocument.diagnostics,
    stats: {
      recordsProcessed: outputDocument.records.length,
      unsupportedStructures: countUnsupported(outputDocument),
      preservedExtensions: countPreservedExtensions(outputDocument)
    }
  };
}
