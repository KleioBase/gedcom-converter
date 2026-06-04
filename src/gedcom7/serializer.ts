import type { GedcomLineEnding, GedcomNode, ParsedDocument } from "../types.js";
import { stringifyGedcomTree } from "../utils/lines.js";
import { GEDCOM7_VERSION } from "./schema.js";

function cloneAtLevel(node: GedcomNode, level: number): GedcomNode {
  return {
    ...node,
    level,
    children: node.children.map((child) => cloneAtLevel(child, level + 1))
  };
}

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
  const rawChildren = document.header.raw.children.filter((child) => child.tag !== "CHAR" && child.tag !== "GEDC");
  const sourceNode = rawChildren.some((child) => child.tag === "SOUR")
    ? []
    : [
        {
          level: 1,
          tag: "SOUR",
          value: document.header.sourceSystem ?? "KleioBase",
          children: [
            {
              level: 2,
              tag: "NAME",
              value: document.header.sourceSystem ?? "KleioBase",
              children: []
            }
          ]
        }
      ];

  return {
    level: 0,
    tag: "HEAD",
    children: [
      ...sourceNode,
      ...rawChildren.map((child) => cloneAtLevel(child, 1)),
      {
        level: 1,
        tag: "GEDC",
        children: [
          {
            level: 2,
            tag: "VERS",
            value: GEDCOM7_VERSION,
            children: []
          }
        ]
      }
    ]
  };
}

export function stringifyGedcom7(document: ParsedDocument, lineEnding: GedcomLineEnding = "LF"): string {
  const nodes: GedcomNode[] = [
    buildHead(document),
    ...document.records.map((record) => toRootNode(record)),
    ...document.extensions.map((node) => resetRootLevel(node)),
    {
      level: 0,
      tag: "TRLR",
      children: []
    }
  ];

  return stringifyGedcomTree(nodes, { mode: "gedcom7", lineEnding });
}
