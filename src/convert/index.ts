import { ConversionError } from "../errors/index.js";
import { parseGedcom551 } from "../gedcom551/parser.js";
import { stringifyGedcom551 } from "../gedcom551/serializer.js";
import { parseGedcom7 } from "../gedcom7/parser.js";
import { stringifyGedcom7 } from "../gedcom7/serializer.js";
import { toIntermediateDocument } from "../ir/types.js";
import { mapGedcom7DocumentTo551 } from "../mappings/v7-to-551.js";
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

export function convertGedcom(input: string | Uint8Array, options: ConvertOptions): ConversionResult {
  const sourceDocument = options.from === "7.0.18" ? parseGedcom7(input) : parseGedcom551(input);
  const intermediate = toIntermediateDocument(sourceDocument);

  let outputDocument: ParsedDocument;

  if (intermediate.version === options.to) {
    outputDocument = intermediate;
  } else if (intermediate.version === "5.5" && options.to === "5.5.1") {
    outputDocument = {
      ...intermediate,
      version: "5.5.1",
      header: {
        ...intermediate.header,
        gedcomVersion: "5.5.1"
      }
    };
  } else if (intermediate.version === "7.0.18" && options.to === "5.5.1") {
    outputDocument = mapGedcom7DocumentTo551(intermediate);
  } else {
    throw new ConversionError(`Conversion from ${options.from} to ${options.to} is not implemented yet.`);
  }

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
