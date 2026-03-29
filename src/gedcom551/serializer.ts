import type { GedcomNode, ParsedDocument } from "../types.js";
import { stringifyGedcomTree } from "../utils/lines.js";
import { GEDCOM551_CHARSET, GEDCOM551_FORM, GEDCOM551_VERSION } from "./schema.js";

const DEFAULT_SUBMITTER_XREF = "@SUBM1@";
const DEFAULT_PRODUCT_VERSION = "0.1.0";

function toRootNode(record: ParsedDocument["records"][number]): GedcomNode {
  return {
    level: 0,
    tag: record.tag,
    children: record.children,
    ...(record.xref !== undefined ? { xref: record.xref } : {}),
    ...(record.value !== undefined ? { value: record.value } : {})
  };
}

function resetRootLevel(node: GedcomNode): GedcomNode {
  return {
    ...node,
    level: 0
  };
}

function buildHead(document: ParsedDocument): GedcomNode {
  return {
    level: 0,
    tag: "HEAD",
    children: [
      {
        level: 1,
        tag: "SOUR",
        value: document.header.sourceSystem ?? "KleioBase",
        children: [
          {
            level: 2,
            tag: "VERS",
            value: DEFAULT_PRODUCT_VERSION,
            children: []
          },
          {
            level: 2,
            tag: "NAME",
            value: document.header.sourceSystem ?? "KleioBase",
            children: []
          }
        ]
      },
      {
        level: 1,
        tag: "GEDC",
        children: [
          {
            level: 2,
            tag: "VERS",
            value: GEDCOM551_VERSION,
            children: []
          },
          {
            level: 2,
            tag: "FORM",
            value: GEDCOM551_FORM,
            children: []
          }
        ]
      },
      {
        level: 1,
        tag: "SUBM",
        value: DEFAULT_SUBMITTER_XREF,
        children: []
      },
      {
        level: 1,
        tag: "CHAR",
        value: GEDCOM551_CHARSET,
        children: []
      }
    ]
  };
}

function buildSubmitterRecord(document: ParsedDocument): GedcomNode {
  return {
    level: 0,
    xref: DEFAULT_SUBMITTER_XREF,
    tag: "SUBM",
    children: [
      {
        level: 1,
        tag: "NAME",
        value: document.header.sourceSystem ?? "KleioBase",
        children: []
      }
    ]
  };
}

export function stringifyGedcom551(document: ParsedDocument): string {
  const nodes: GedcomNode[] = [
    buildHead(document),
    ...document.records.map((record) => toRootNode(record)),
    ...document.extensions.map((node) => resetRootLevel(node)),
    buildSubmitterRecord(document),
    {
      level: 0,
      tag: "TRLR",
      children: []
    }
  ];

  return stringifyGedcomTree(nodes);
}
