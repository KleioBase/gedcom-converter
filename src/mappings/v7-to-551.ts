import type { Diagnostic, GedcomNode, ParsedDocument, ParsedRecord } from "../types.js";
import { mapGedcom7DateNodeTo551 } from "./date/v7-to-551.js";

interface MappingContext {
  rootTag: string;
  parentTag?: string;
  grandParentTag?: string;
}

const POINTER_TAGS = new Set([
  "ALIA",
  "ANCI",
  "ASSO",
  "CHIL",
  "DESI",
  "FAMC",
  "FAMS",
  "HUSB",
  "NOTE",
  "OBJE",
  "REPO",
  "SOUR",
  "SUBM",
  "WIFE"
]);

const ROLE_TEXT_ALIASES: Record<string, string> = {
  CHIL: "Child",
  CLERGY: "Clergy",
  FATH: "Father",
  FRIEND: "Friend",
  GODP: "Godparent",
  HUSB: "Husband",
  MOTH: "Mother",
  MULTIPLE: "Multiple",
  NGHBR: "Neighbor",
  OFFICIATOR: "Officiator",
  PARENT: "Parent",
  SPOU: "Spouse",
  WIFE: "Wife",
  WITN: "Witness"
};

function extendMappingContext(context: MappingContext, parentTag: string): MappingContext {
  return {
    rootTag: context.rootTag,
    parentTag,
    ...(context.parentTag !== undefined ? { grandParentTag: context.parentTag } : {})
  };
}

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
    case "image/jpg":
      return "jpeg";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    case "image/tiff":
      return "tiff";
    case "audio/wav":
      return "wav";
    case "audio/mp3":
    case "audio/mpeg":
      return "mp3";
    case "video/mp4":
      return "mp4";
    case "application/pdf":
      return "pdf";
    case "text/plain":
      return "txt";
    default:
      return undefined;
  }
}

function mapGedcom7NameTypeTo551(value: string | undefined): string | undefined {
  switch (value) {
    case "AKA":
      return "aka";
    case "BIRTH":
      return "birth";
    case "IMMIGRANT":
      return "immigrant";
    case "MAIDEN":
      return "maiden";
    case "MARRIED":
      return "married";
    default:
      return value;
  }
}

function humanizeEnumValue(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }

  if (ROLE_TEXT_ALIASES[value]) {
    return ROLE_TEXT_ALIASES[value];
  }

  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter((token) => token.length > 0)
    .map((token) => token[0]!.toUpperCase() + token.slice(1))
    .join(" ");
}

function appendSourceCitationLine(
  value: string | undefined,
  pointer: string | undefined,
  page: string | undefined
): string {
  const pieces = [`Source citation${pointer ? ` ${pointer}` : ""}`];
  if (page) {
    pieces.push(`Page ${page}`);
  }

  const line = `[${pieces.join(", ")}]`;
  return value ? `${value}\n${line}` : line;
}

function labelForMissingPointerTag(tag: string): string {
  switch (tag) {
    case "ALIA":
      return "Alias reference";
    case "ANCI":
      return "Ancestor-interest reference";
    case "ASSO":
      return "Association";
    case "CHIL":
      return "Child reference";
    case "DESI":
      return "Descendant-interest reference";
    case "FAMC":
      return "Family-as-child reference";
    case "FAMS":
      return "Family-as-spouse reference";
    case "HUSB":
      return "Husband reference";
    case "NOTE":
      return "Related note reference";
    case "OBJE":
      return "Multimedia reference";
    case "REPO":
      return "Repository reference";
    case "SOUR":
      return "Source citation";
    case "SUBM":
      return "Submitter reference";
    case "WIFE":
      return "Wife reference";
    default:
      return `${tag} reference`;
  }
}

function buildMissingPointerNoteValue(node: GedcomNode): string {
  const lines = [`${labelForMissingPointerTag(node.tag)}: ${node.value ?? "@VOID@"}`];

  for (const child of node.children) {
    if (!child.value && child.children.length === 0) {
      continue;
    }

    if (child.tag === "PAGE") {
      lines.push(`Page: ${child.value ?? ""}`);
      continue;
    }

    if (child.tag === "NOTE" || child.tag === "SNOTE") {
      if (child.value) {
        lines.push(`${child.value.startsWith("@") ? "Related note" : "Note"}: ${child.value}`);
      }
      continue;
    }

    if (child.tag === "SOUR") {
      const pageChild = child.children.find((grandchild) => grandchild.tag === "PAGE" && grandchild.value);
      lines.push(appendSourceCitationLine(undefined, child.value, pageChild?.value));
      continue;
    }

    if (child.tag === "ROLE") {
      const phrase = child.children.find((grandchild) => grandchild.tag === "PHRASE" && grandchild.value)?.value;
      lines.push(`Role: ${phrase ?? humanizeEnumValue(child.value) ?? ""}`);
      continue;
    }

    if (child.tag === "PHRASE") {
      lines.push(`Phrase: ${child.value ?? ""}`);
      continue;
    }

    if (child.tag === "ADOP") {
      lines.push(`Adoption: ${humanizeEnumValue(child.value) ?? ""}`);
      const phrase = child.children.find((grandchild) => grandchild.tag === "PHRASE" && grandchild.value)?.value;
      if (phrase) {
        lines.push(`Phrase: ${phrase}`);
      }
      continue;
    }

    if (child.tag === "PEDI") {
      lines.push(`Pedigree: ${humanizeEnumValue(child.value) ?? ""}`);
      const phrase = child.children.find((grandchild) => grandchild.tag === "PHRASE" && grandchild.value)?.value;
      if (phrase) {
        lines.push(`Phrase: ${phrase}`);
      }
      continue;
    }

    if (child.tag === "STAT") {
      lines.push(`Status: ${humanizeEnumValue(child.value) ?? ""}`);
      const phrase = child.children.find((grandchild) => grandchild.tag === "PHRASE" && grandchild.value)?.value;
      if (phrase) {
        lines.push(`Phrase: ${phrase}`);
      }
      continue;
    }

    if (child.tag === "TITL") {
      lines.push(`Title: ${child.value ?? ""}`);
      continue;
    }

    if (child.tag === "TEMP") {
      lines.push(`Temple: ${child.value ?? ""}`);
      continue;
    }

    lines.push(`${humanizeEnumValue(child.tag) ?? child.tag}: ${child.value ?? ""}`);
  }

  return lines.join("\n");
}

function mapVoidPointerNodeToNote(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  diagnostics.push({
    severity: "info",
    code: "VOID_POINTER_NOTED",
    message: `Preserved ${node.tag} ${node.value ?? "@VOID@"} as note text for GEDCOM 5.5.1 compatibility.`,
    location: withOptionalLocation(node)
  });

  return makeNode({
    level: node.level,
    tag: "NOTE",
    value: buildMissingPointerNoteValue(node),
    children: []
  });
}

function inferMediaType(mime: string | undefined): string | undefined {
  if (!mime) {
    return undefined;
  }

  if (mime.startsWith("image/")) {
    return "photo";
  }

  if (mime.startsWith("audio/")) {
    return "audio";
  }

  if (mime.startsWith("video/")) {
    return "video";
  }

  return "electronic";
}

function mapRoleToRela(node: GedcomNode, diagnostics: Diagnostic[]): GedcomNode {
  const phrase = node.children.find((child) => child.tag === "PHRASE")?.value;
  let value = humanizeEnumValue(node.value);

  if (node.value === "OTHER" && phrase) {
    value = phrase;
  } else if (value) {
    diagnostics.push({
      severity: "info",
      code: "ROLE_TO_RELA_FALLBACK",
      message: `Mapped GEDCOM 7 ROLE ${node.value} to GEDCOM 5.5.1 RELA text ${value}.`,
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

function mapRoleToSourceCitationRole(node: GedcomNode): GedcomNode {
  const phrase = node.children.find((child) => child.tag === "PHRASE")?.value;

  const supportedRole = (() => {
    switch (node.value) {
      case "CHIL":
      case "HUSB":
      case "WIFE":
      case "MOTH":
      case "FATH":
      case "SPOU":
        return node.value;
      default:
        return undefined;
    }
  })();

  if (supportedRole) {
    return makeNode({
      level: node.level,
      tag: "ROLE",
      value: supportedRole,
      children: []
    });
  }

  const descriptor = phrase ?? humanizeEnumValue(node.value) ?? "Associated";

  return makeNode({
    level: node.level,
    tag: "ROLE",
    value: `(${descriptor})`,
    children: []
  });
}

function canMapExidToRefn(context: MappingContext, value: string): boolean {
  return context.parentTag === undefined && context.rootTag !== "SUBM" && value.length > 0 && value.length <= 20;
}

function mapExidNode(node: GedcomNode, diagnostics: Diagnostic[], context: MappingContext): GedcomNode {
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

  if (canMapExidToRefn(context, value)) {
    diagnostics.push({
      severity: "info",
      code: "EXID_TO_REFN",
      message: `Mapped EXID with TYPE ${typeValue || "<missing>"} to GEDCOM 5.5.1 REFN.`,
      location: withOptionalLocation(node)
    });

    return makeNode({
      level: node.level,
      tag: "REFN",
      value,
      children: typeNode ? [cloneNode(typeNode)] : []
    });
  }

  diagnostics.push({
    severity: "info",
    code: "EXID_PRESERVED",
    message: `Preserved EXID with TYPE ${typeValue || "<missing>"} for later GEDCOM 5.5.1 compatibility handling.`,
    location: withOptionalLocation(node)
  });

  return makeNode({
    level: node.level,
    tag: "_EXID",
    value,
    children: typeNode ? [cloneNode(typeNode)] : []
  });
}

function mapNode(node: GedcomNode, diagnostics: Diagnostic[], context: MappingContext): GedcomNode | null {
  if (node.tag.startsWith("_")) {
    return cloneNode(node);
  }

  if (node.tag === "SNOTE") {
    if (node.value === "@VOID@") {
      return mapVoidPointerNodeToNote(
        {
          ...node,
          tag: "NOTE"
        },
        diagnostics
      );
    }

    return makeNode({
      level: node.level,
      tag: "NOTE",
      ...(node.value !== undefined ? { value: node.value } : {}),
      ...(node.xref !== undefined ? { xref: node.xref } : {}),
      children: node.children
        .map((child) =>
          mapNode(child, diagnostics, extendMappingContext(context, node.tag))
        )
        .filter((child): child is GedcomNode => child !== null)
    });
  }

  if (POINTER_TAGS.has(node.tag) && node.value === "@VOID@") {
    return mapVoidPointerNodeToNote(node, diagnostics);
  }

  if (node.tag === "ROLE") {
    if (context.parentTag === "EVEN" && context.grandParentTag === "SOUR") {
      return mapRoleToSourceCitationRole(node);
    }

    return mapRoleToRela(node, diagnostics);
  }

  if (node.tag === "EXID") {
    return mapExidNode(node, diagnostics, context);
  }

  if (node.tag === "DATE") {
    return mapGedcom7DateNodeTo551(
      {
        ...node,
        children: node.children
          .map((child) =>
            mapNode(child, diagnostics, extendMappingContext(context, node.tag))
          )
          .filter((child): child is GedcomNode => child !== null)
      },
      diagnostics
    );
  }

  if (node.tag === "TYPE" && context.parentTag === "NAME") {
    const phrase = node.children.find((child) => child.tag === "PHRASE")?.value;
    const mappedValue = phrase ?? mapGedcom7NameTypeTo551(node.value);

    return makeNode({
      level: node.level,
      tag: "TYPE",
      ...(mappedValue !== undefined ? { value: mappedValue } : {}),
      children: []
    });
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

  if (node.tag === "FILE") {
    const mappedChildren: GedcomNode[] = [];
    const formNode = node.children.find((child) => child.tag === "FORM");
    const mediaTypeNode = formNode?.children.find((child) => child.tag === "MEDI");
    const mappedForm = mapMimeToForm(formNode?.value);
    const mappedMediaType = mediaTypeNode?.value?.toLowerCase() ?? inferMediaType(formNode?.value);

    if (mappedForm) {
      const formChildren = mappedMediaType
        ? [makeNode({ level: 3, tag: "TYPE", value: mappedMediaType, children: [] })]
        : [];

      mappedChildren.push(
        makeNode({
          level: 2,
          tag: "FORM",
          value: mappedForm,
          children: formChildren
        })
      );
    } else if (formNode?.value) {
      diagnostics.push({
        severity: "warning",
        code: "UNSUPPORTED_MEDIA_FORMAT",
        message: `Unable to map multimedia media type ${formNode.value} to GEDCOM 5.5.1 FORM.`,
        location: withOptionalLocation(formNode)
      });
    }

    for (const child of node.children) {
      if (child.tag === "FORM") {
        continue;
      }

      const mappedChild = mapNode(child, diagnostics, extendMappingContext(context, node.tag));
      if (mappedChild) {
        mappedChildren.push(mappedChild);
      }
    }

    return makeNode({
      level: node.level,
      tag: "FILE",
      ...(node.value !== undefined ? { value: node.value } : {}),
      children: mappedChildren
    });
  }

  return makeNode({
    level: node.level,
    tag: node.tag,
    ...(node.value !== undefined ? { value: node.value } : {}),
    ...(node.xref !== undefined ? { xref: node.xref } : {}),
    children: node.children
      .map((child) =>
        mapNode(child, diagnostics, extendMappingContext(context, node.tag))
      )
      .filter((child): child is GedcomNode => child !== null)
  });
}

function mapRecord(record: ParsedRecord, diagnostics: Diagnostic[]): ParsedRecord {
  const mappedTag = record.tag === "SNOTE" ? "NOTE" : record.tag;

  return {
    tag: mappedTag,
    children: record.children
      .map((child) => mapNode(child, diagnostics, { rootTag: mappedTag }))
      .filter((child): child is GedcomNode => child !== null),
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
      characterSet: "UTF-8"
    },
    records: document.records.map((record) => mapRecord(record, diagnostics)),
    extensions: document.extensions.map(cloneNode),
    diagnostics
  };
}
