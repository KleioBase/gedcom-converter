import type { Diagnostic, GedcomNode, ParsedDocument, ParsedRecord } from "../types.js";

function cloneNode(node: GedcomNode): GedcomNode {
  return {
    ...node,
    children: node.children.map(cloneNode)
  };
}

function withOptionalLocation(node: GedcomNode): { line?: number; tag: string } {
  return {
    tag: node.tag,
    ...(node.lineNumber !== undefined ? { line: node.lineNumber } : {})
  };
}

function makeNode(base: {
  level: number;
  tag: string;
  children: GedcomNode[];
  value?: string;
  xref?: string;
}): GedcomNode {
  return {
    level: base.level,
    tag: base.tag,
    children: base.children,
    ...(base.value !== undefined ? { value: base.value } : {}),
    ...(base.xref !== undefined ? { xref: base.xref } : {})
  };
}

function mapMimeToForm(mime: string | undefined): string | undefined {
  switch (mime) {
    case "image/jpeg":
      return "jpeg";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    case "image/tiff":
      return "tiff";
    case "audio/wav":
      return "wav";
    default:
      return undefined;
  }
}

function mapRoleToRela(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const phrase = node.children.find((child) => child.tag === "PHRASE")?.value;
  let value = node.value;

  if (value === "WITN") {
    value = "Witness";
  } else if (value === "OTHER" && phrase) {
    value = phrase;
  } else if (value) {
    diagnostics.push({
      severity: "warning",
      code: "ROLE_TO_RELA_FALLBACK",
      message: `Mapped GEDCOM 7 ROLE ${value} to GEDCOM 5.5.1 RELA text.`,
      location: withOptionalLocation(node)
    });
  }

  return makeNode({
    level: node.level,
    tag: "RELA",
    ...(value !== undefined ? { value } : {}),
    children: []
  });
}

function mapExidNode(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const typeNode = node.children.find((child) => child.tag === "TYPE");
  const typeValue = typeNode?.value ?? "";
  const value = node.value ?? "";

  if (typeValue.endsWith("/AFN")) {
    return makeNode({ level: node.level, tag: "AFN", value, children: [] });
  }

  if (typeValue.includes("/RIN")) {
    return makeNode({ level: node.level, tag: "RIN", value, children: [] });
  }

  if (typeValue.includes("/RFN#")) {
    return makeNode({ level: node.level, tag: "RFN", value, children: [] });
  }

  diagnostics.push({
      severity: "warning",
      code: "UNSUPPORTED_EXID",
      message: `Unable to map EXID with TYPE ${typeValue || "<missing>"} to GEDCOM 5.5.1.`,
      location: withOptionalLocation(node)
    });

  return makeNode({
    level: node.level,
    tag: "_EXID",
    value,
    children: typeNode ? [cloneNode(typeNode)] : []
  });
}

function mapNode(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode | null {
  if (node.tag.startsWith("_")) {
    return cloneNode(node);
  }

  if (node.tag === "SNOTE") {
    return makeNode({
      level: node.level,
      tag: "NOTE",
      ...(node.value !== undefined ? { value: node.value } : {}),
      ...(node.xref !== undefined ? { xref: node.xref } : {}),
      children: node.children.map((child) => mapNode(child, diagnostics)).filter((child): child is GedcomNode => child !== null)
    });
  }

  if (node.tag === "ROLE") {
    return mapRoleToRela(node, diagnostics);
  }

  if (node.tag === "EXID") {
    return mapExidNode(node, diagnostics);
  }

  if (node.tag === "MIME") {
    const mapped = mapMimeToForm(node.value);
    if (!mapped) {
      diagnostics.push({
        severity: "warning",
        code: "UNSUPPORTED_MIME",
        message: `Unable to map MIME ${node.value ?? "<missing>"} to GEDCOM 5.5.1 FORM.`,
        location: withOptionalLocation(node)
      });
      return null;
    }

    return makeNode({
      level: node.level,
      tag: "FORM",
      value: mapped,
      children: []
    });
  }

  return makeNode({
    level: node.level,
    tag: node.tag,
    ...(node.value !== undefined ? { value: node.value } : {}),
    ...(node.xref !== undefined ? { xref: node.xref } : {}),
    children: node.children.map((child) => mapNode(child, diagnostics)).filter((child): child is GedcomNode => child !== null)
  });
}

function mapRecord(record: ParsedRecord, diagnostics: Diagnostic[]): ParsedRecord {
  const mappedTag = record.tag === "SNOTE" ? "NOTE" : record.tag;

  return {
    tag: mappedTag,
    children: record.children.map((child) => mapNode(child, diagnostics)).filter((child): child is GedcomNode => child !== null),
    ...(record.xref !== undefined ? { xref: record.xref } : {}),
    ...(record.value !== undefined ? { value: record.value } : {})
  };
}

export function mapGedcom7DocumentTo551(document: ParsedDocument): ParsedDocument {
  const diagnostics = [...document.diagnostics];

  return {
    version: "5.5.1",
    header: {
      ...document.header,
      gedcomVersion: "5.5.1",
      characterSet: "UNICODE"
    },
    records: document.records.map((record) => mapRecord(record, diagnostics)),
    extensions: document.extensions.map(cloneNode),
    diagnostics
  };
}
