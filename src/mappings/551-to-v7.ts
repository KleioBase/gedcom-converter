import type { GedcomNode, ParsedDocument, ParsedRecord } from "../types.js";

interface MappingContext {
  parentTag?: string;
}

const PRESERVED_HEADER_TAGS = new Set(["SOUR", "DEST", "DATE", "SUBM", "COPR", "FILE", "NOTE", "PLAC"]);
const GEDCOM7_NAME_TYPES = new Set(["AKA", "BIRTH", "IMMIGRANT", "MAIDEN", "MARRIED", "PROFESSIONAL", "OTHER"]);

const GEDCOM551_NAME_TYPE_ALIASES: Record<string, string> = {
  AKA: "AKA",
  ALSO_KNOWN_AS: "AKA",
  ALIAS: "AKA",
  BIRTH: "BIRTH",
  IMMIGRANT: "IMMIGRANT",
  IMMIGRATION: "IMMIGRANT",
  MAIDEN: "MAIDEN",
  MARRIED: "MARRIED",
  PROFESSIONAL: "PROFESSIONAL",
  PROFESSION: "PROFESSIONAL",
  OTHER: "OTHER"
};

function extendMappingContext(parentTag: string): MappingContext {
  return {
    parentTag
  };
}

function cloneNode(node: GedcomNode): GedcomNode {
  return {
    ...node,
    children: node.children.map(cloneNode)
  };
}

function cloneAtLevel(node: GedcomNode, level: number): GedcomNode {
  return {
    ...cloneNode(node),
    level,
    children: node.children.map((child) => cloneAtLevel(child, level + 1))
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

function normalizeNameTypeToken(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function mapGedcom551NameTypeToV7(value: string | undefined): GedcomNode["value"] {
  if (!value) {
    return value;
  }

  const normalized = normalizeNameTypeToken(value);
  return GEDCOM551_NAME_TYPE_ALIASES[normalized] ?? (GEDCOM7_NAME_TYPES.has(normalized) ? normalized : undefined);
}

function mapNameTypeNode(node: GedcomNode): GedcomNode {
  const mappedValue = mapGedcom551NameTypeToV7(node.value);

  if (mappedValue) {
    return makeNode({
      level: node.level,
      tag: "TYPE",
      value: mappedValue,
      children: []
    });
  }

  return makeNode({
    level: node.level,
    tag: "TYPE",
    value: "OTHER",
    children: node.value
      ? [
          makeNode({
            level: node.level + 1,
            tag: "PHRASE",
            value: node.value,
            children: []
          })
        ]
      : []
  });
}

function collectCustomTagsFromNode(node: GedcomNode, tags: Set<string>): void {
  if (node.tag.startsWith("_")) {
    tags.add(node.tag);
  }

  for (const child of node.children) {
    collectCustomTagsFromNode(child, tags);
  }
}

function collectCustomTags(document: ParsedDocument): string[] {
  const tags = new Set<string>();

  for (const child of document.header.raw.children) {
    collectCustomTagsFromNode(child, tags);
  }

  for (const record of document.records) {
    for (const child of record.children) {
      collectCustomTagsFromNode(child, tags);
    }
  }

  for (const extension of document.extensions) {
    collectCustomTagsFromNode(extension, tags);
  }

  return [...tags].sort();
}

function buildGedcomNode(): GedcomNode {
  return makeNode({
    level: 1,
    tag: "GEDC",
    children: [
      makeNode({
        level: 2,
        tag: "VERS",
        value: "7.0.18",
        children: []
      })
    ]
  });
}

function buildSchemaNode(customTags: string[]): GedcomNode | null {
  if (customTags.length === 0) {
    return null;
  }

  return makeNode({
    level: 1,
    tag: "SCHMA",
    children: customTags.map((tag) =>
      makeNode({
        level: 2,
        tag: "TAG",
        value: tag,
        children: []
      })
    )
  });
}

function mapHeader(document: ParsedDocument): ParsedDocument["header"] {
  const preservedChildren = document.header.raw.children
    .filter((child) => PRESERVED_HEADER_TAGS.has(child.tag))
    .map((child) => cloneAtLevel(child, 1));
  const schemaNode = buildSchemaNode(collectCustomTags(document));

  return {
    ...document.header,
    gedcomVersion: "7.0.18",
    characterSet: "UTF-8",
    raw: makeNode({
      level: 0,
      tag: "HEAD",
      children: [
        ...preservedChildren,
        buildGedcomNode(),
        ...(schemaNode ? [schemaNode] : [])
      ]
    })
  };
}

function mapNode(node: GedcomNode, context: MappingContext): GedcomNode {
  if (node.tag === "TYPE" && context.parentTag === "NAME") {
    return mapNameTypeNode(node);
  }

  return makeNode({
    level: node.level,
    tag: node.tag,
    children: node.children.map((child) => mapNode(child, extendMappingContext(node.tag))),
    ...(node.value !== undefined ? { value: node.value } : {}),
    ...(node.xref !== undefined ? { xref: node.xref } : {})
  });
}

function mapRecord(record: ParsedRecord): ParsedRecord {
  return {
    tag: record.tag,
    children: record.children.map((child) => mapNode(child, {})),
    ...(record.xref !== undefined ? { xref: record.xref } : {}),
    ...(record.value !== undefined ? { value: record.value } : {})
  };
}

export function mapGedcom551DocumentToV7(document: ParsedDocument): ParsedDocument {
  return {
    version: "7.0.18",
    header: mapHeader(document),
    records: document.records.map(mapRecord),
    extensions: document.extensions.map(cloneNode),
    diagnostics: [...document.diagnostics]
  };
}
