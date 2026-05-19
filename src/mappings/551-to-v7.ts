import type { GedcomNode, ParsedDocument, ParsedRecord } from "../types.js";

const PRESERVED_HEADER_TAGS = new Set(["SOUR", "DEST", "DATE", "SUBM", "COPR", "FILE", "NOTE", "PLAC"]);

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

function mapRecord(record: ParsedRecord): ParsedRecord {
  return {
    tag: record.tag,
    children: record.children.map(cloneNode),
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
